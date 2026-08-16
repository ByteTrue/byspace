#define _DARWIN_C_SOURCE 1

#include "byspace-macos-tunnel.h"
#include "byspace-tunnel-protocol.h"

#include <dirent.h>
#include <errno.h>
#include <grp.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <pwd.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <hev-main.h>
#include <hev-socks5-tunnel.h>

struct TunnelWorker {
    char config[2048];
    int tunnel_fd;
    int ready_fd;
    atomic_int done;
    int result;
};

enum {
    CHILD_READY = 1,
    WORKER_READY_TIMEOUT_MS = 5000,
    WORKER_STOP_TIMEOUT_MS = 3000,
    WORKER_TERM_TIMEOUT_MS = 1000,
    WORKER_KILL_TIMEOUT_MS = 1000,
};

static volatile sig_atomic_t signal_pipe_write_fd = -1;

static void handle_signal(int signal_number)
{
    uint8_t value = (uint8_t)signal_number;
    sig_atomic_t signal_fd = signal_pipe_write_fd;
    int saved_errno = errno;

    if (signal_fd >= 0) {
        write((int)signal_fd, &value, sizeof(value));
    }
    errno = saved_errno;
}

static void tunnel_worker_ready(void *argument)
{
    struct TunnelWorker *worker = argument;
    uint8_t event = CHILD_READY;

    write(worker->ready_fd, &event, sizeof(event));
}

static void *tunnel_worker_entry(void *argument)
{
    struct TunnelWorker *worker = argument;

    worker->result = hev_socks5_tunnel_main_from_str(
        (const unsigned char *)worker->config,
        (unsigned int)strlen(worker->config), worker->tunnel_fd);
    atomic_store_explicit(&worker->done, 1, memory_order_release);
    return NULL;
}

static int write_all(int fd, const uint8_t *buffer, size_t length)
{
    while (length > 0) {
        ssize_t written = write(fd, buffer, length);

        if (written > 0) {
            buffer += written;
            length -= (size_t)written;
            continue;
        }
        if (written < 0 && errno == EINTR) {
            continue;
        }
        return -1;
    }
    return 0;
}

static int read_exact(int fd, int cancel_fd, uint8_t *buffer, size_t length,
                      int64_t deadline_ns)
{
    size_t initial_length = length;

    while (length > 0) {
        struct timespec now;
        struct pollfd poll_fds[2] = {
            {.fd = fd, .events = POLLIN},
            {.fd = cancel_fd, .events = POLLIN},
        };
        int64_t now_ns;
        int64_t remaining_ns;
        int timeout_ms;
        int ready;
        ssize_t received;

        if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
            return -1;
        }
        now_ns = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
        remaining_ns = deadline_ns - now_ns;
        if (remaining_ns <= 0) {
            errno = ETIMEDOUT;
            return -1;
        }
        timeout_ms = (int)((remaining_ns + 999999LL) / 1000000LL);
        ready = poll(poll_fds, 2, timeout_ms);
        if (ready < 0 && errno == EINTR) {
            continue;
        }
        if (ready == 0) {
            errno = ETIMEDOUT;
            return -1;
        }
        if (ready < 0) {
            return -1;
        }
        if (poll_fds[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            errno = ECANCELED;
            return -1;
        }
        if (poll_fds[0].revents & (POLLERR | POLLNVAL)) {
            return -1;
        }
        received = read(fd, buffer, length);
        if (received > 0) {
            buffer += received;
            length -= (size_t)received;
            continue;
        }
        if (received < 0 && errno == EINTR) {
            continue;
        }
        if (received == 0 && length == initial_length) {
            return 0;
        }
        if (received == 0) {
            errno = EPROTO;
        }
        return -1;
    }
    return 1;
}

static int read_request(int fd, int cancel_fd,
                        struct BySpaceTunnelRequest *request, char *error,
                        size_t error_size)
{
    uint8_t frame[BYSPACE_TUNNEL_HEADER_SIZE + BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE];
    struct timespec now;
    int64_t deadline_ns;
    uint32_t payload_length;
    int result;

    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        snprintf(error, error_size, "read monotonic clock");
        return -1;
    }
    deadline_ns = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec +
                  5000000000LL;
    result = read_exact(fd, cancel_fd, frame, BYSPACE_TUNNEL_HEADER_SIZE,
                        deadline_ns);
    if (result <= 0) {
        if (result < 0 && errno == ECANCELED) {
            return -2;
        }
        if (result < 0) {
            snprintf(error, error_size, "read request header failed");
        }
        return result;
    }
    payload_length = byspace_tunnel_payload_length(frame);
    if (payload_length > BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE) {
        snprintf(error, error_size, "payload is too large");
        return -1;
    }
    result = read_exact(fd, cancel_fd, frame + BYSPACE_TUNNEL_HEADER_SIZE,
                        payload_length, deadline_ns);
    if (result <= 0) {
        if (result < 0 && errno == ECANCELED) {
            return -2;
        }
        snprintf(error, error_size, "truncated request frame");
        return -1;
    }
    if (byspace_tunnel_decode_request(
            frame, BYSPACE_TUNNEL_HEADER_SIZE + payload_length, request, error,
            error_size) != 0) {
        return -1;
    }
    return 1;
}

static int send_frame(int fd, uint8_t opcode, const uint8_t *payload,
                      uint32_t payload_length)
{
    uint8_t frame[BYSPACE_TUNNEL_HEADER_SIZE + BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE];
    size_t frame_length = byspace_tunnel_encode_frame(
        opcode, payload, payload_length, frame, sizeof(frame));

    if (frame_length == 0) {
        return -1;
    }
    return write_all(fd, frame, frame_length);
}

static int send_error(int fd, const char *message)
{
    uint8_t payload[BYSPACE_TUNNEL_MAX_PAYLOAD_SIZE];
    size_t message_length = strnlen(message, sizeof(payload));

    memcpy(payload, message, message_length);
    return send_frame(fd, BYSPACE_TUNNEL_OPCODE_ERROR, payload,
                      (uint32_t)message_length);
}

static int send_ready(int fd, const struct BySpaceMacosTunnel *tunnel,
                      uint32_t peer_ipv4)
{
    uint8_t payload[BYSPACE_TUNNEL_READY_PAYLOAD_SIZE];

    memcpy(payload, &peer_ipv4, sizeof(peer_ipv4));
    memset(payload + sizeof(peer_ipv4), 0, IFNAMSIZ);
    memcpy(payload + sizeof(peer_ipv4), tunnel->interface_name,
           strnlen(tunnel->interface_name, IFNAMSIZ));
    return send_frame(fd, BYSPACE_TUNNEL_OPCODE_READY, payload, sizeof(payload));
}

static int authenticate_control_fd(int fd, uid_t owner_uid, char *error,
                                   size_t error_size)
{
    int socket_type;
    socklen_t socket_type_size = sizeof(socket_type);
    struct sockaddr_storage peer_address;
    socklen_t peer_address_size = sizeof(peer_address);
    uid_t peer_uid;
    gid_t peer_gid;
    int socket_option = 1;
    struct timeval send_timeout = {.tv_sec = 5, .tv_usec = 0};

    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &socket_type, &socket_type_size) != 0 ||
        socket_type != SOCK_STREAM) {
        snprintf(error, error_size, "control fd is not a stream socket");
        return -1;
    }
    if (getpeername(fd, (struct sockaddr *)&peer_address, &peer_address_size) != 0 ||
        peer_address.ss_family != AF_UNIX) {
        snprintf(error, error_size, "control fd is not a Unix socket");
        return -1;
    }
    if (getpeereid(fd, &peer_uid, &peer_gid) != 0 || peer_uid != owner_uid) {
        snprintf(error, error_size, "control peer is not the authorized daemon user");
        return -1;
    }
    if (setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &socket_option,
                   sizeof(socket_option)) != 0 ||
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &send_timeout,
                   sizeof(send_timeout)) != 0) {
        snprintf(error, error_size, "cannot bound control socket writes");
        return -1;
    }
    return 0;
}

static int parse_owner_uid(const char *value, uid_t *owner_uid)
{
    char *end = NULL;
    unsigned long parsed;

    errno = 0;
    parsed = strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed > UINT32_MAX) {
        return -1;
    }
    *owner_uid = (uid_t)parsed;
    return 0;
}

static int install_signal_handlers(int signal_pipe[2])
{
    struct sigaction action;

    if (pipe(signal_pipe) != 0) {
        return -1;
    }
    if (fcntl(signal_pipe[0], F_SETFD, FD_CLOEXEC) != 0 ||
        fcntl(signal_pipe[1], F_SETFD, FD_CLOEXEC) != 0 ||
        fcntl(signal_pipe[1], F_SETFL, O_NONBLOCK) != 0) {
        close(signal_pipe[0]);
        close(signal_pipe[1]);
        return -1;
    }
    signal_pipe_write_fd = signal_pipe[1];
    memset(&action, 0, sizeof(action));
    sigemptyset(&action.sa_mask);
    action.sa_handler = handle_signal;
    if (sigaction(SIGTERM, &action, NULL) != 0 ||
        sigaction(SIGINT, &action, NULL) != 0) {
        close(signal_pipe[0]);
        close(signal_pipe[1]);
        signal_pipe_write_fd = -1;
        return -1;
    }
    signal(SIGPIPE, SIG_IGN);
    return 0;
}

static int drop_worker_privileges(uid_t owner_uid)
{
    struct passwd password;
    struct passwd *resolved = NULL;
    char buffer[16384];
    int lookup_result;

    lookup_result = getpwuid_r(owner_uid, &password, buffer, sizeof(buffer),
                               &resolved);
    if (lookup_result != 0 || resolved == NULL || owner_uid == 0) {
        return -1;
    }
    if (setgroups(0, NULL) != 0 || setgid(resolved->pw_gid) != 0 ||
        setuid(owner_uid) != 0) {
        return -1;
    }
    return getuid() == owner_uid && geteuid() == owner_uid ? 0 : -1;
}

static int redirect_worker_standard_fds(void)
{
    int null_fd = open("/dev/null", O_RDWR);
    int fd;

    if (null_fd < 0) {
        return -1;
    }
    for (fd = STDIN_FILENO; fd <= STDERR_FILENO; fd++) {
        if (dup2(null_fd, fd) < 0) {
            if (null_fd > STDERR_FILENO) {
                close(null_fd);
            }
            return -1;
        }
    }
    if (null_fd > STDERR_FILENO) {
        close(null_fd);
    }
    return 0;
}

static int run_worker_child(const char *config, int tunnel_fd, int stop_fd,
                            int ready_fd, uid_t owner_uid)
{
    struct TunnelWorker worker;
    struct sigaction default_action;
    pthread_t worker_thread;
    int worker_started = 0;
    int stop_requested = 0;
    int result = 1;

    memset(&default_action, 0, sizeof(default_action));
    sigemptyset(&default_action.sa_mask);
    default_action.sa_handler = SIG_DFL;
    if (sigaction(SIGTERM, &default_action, NULL) != 0 ||
        sigaction(SIGINT, &default_action, NULL) != 0 ||
        signal(SIGPIPE, SIG_IGN) == SIG_ERR ||
        redirect_worker_standard_fds() != 0 ||
        drop_worker_privileges(owner_uid) != 0) {
        return 1;
    }

    memset(&worker, 0, sizeof(worker));
    if (snprintf(worker.config, sizeof(worker.config), "%s", config) >=
        (int)sizeof(worker.config)) {
        return 1;
    }
    worker.tunnel_fd = tunnel_fd;
    worker.ready_fd = ready_fd;
    worker.result = -1;
    atomic_init(&worker.done, 0);
    hev_socks5_tunnel_set_ready_callback(tunnel_worker_ready, &worker);
    if (pthread_create(&worker_thread, NULL, tunnel_worker_entry, &worker) != 0) {
        hev_socks5_tunnel_set_ready_callback(NULL, NULL);
        return 1;
    }
    worker_started = 1;

    while (!atomic_load_explicit(&worker.done, memory_order_acquire)) {
        struct pollfd stop = {.fd = stop_fd, .events = POLLIN};
        int ready = poll(&stop, 1, 100);

        if (ready < 0 && errno == EINTR) {
            continue;
        }
        if (ready < 0 ||
            (ready > 0 &&
             (stop.revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)))) {
            stop_requested = 1;
            break;
        }
    }
    if (worker_started &&
        !atomic_load_explicit(&worker.done, memory_order_acquire) &&
        stop_requested) {
        hev_socks5_tunnel_quit();
    }
    if (worker_started && pthread_join(worker_thread, NULL) == 0) {
        result = worker.result == 0 ? 0 : 1;
    }
    hev_socks5_tunnel_set_ready_callback(NULL, NULL);
    return result;
}

static int wait_for_child_exit(pid_t child_pid, int timeout_ms, int *status)
{
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 20000000};
    int elapsed_ms = 0;

    while (elapsed_ms <= timeout_ms) {
        pid_t waited = waitpid(child_pid, status, WNOHANG);

        if (waited == child_pid) {
            return 1;
        }
        if (waited < 0) {
            return -1;
        }
        if (elapsed_ms == timeout_ms) {
            break;
        }
        nanosleep(&delay, NULL);
        elapsed_ms += 20;
        if (elapsed_ms > timeout_ms) {
            elapsed_ms = timeout_ms;
        }
    }
    return 0;
}

static int wait_for_child_ready(pid_t child_pid, int ready_fd, int cancel_fd,
                                int *child_reaped, int *child_status)
{
    struct timespec now;
    int64_t deadline_ns;

    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        return -1;
    }
    deadline_ns = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec +
                  (int64_t)WORKER_READY_TIMEOUT_MS * 1000000LL;
    for (;;) {
        struct pollfd poll_fds[2] = {
            {.fd = ready_fd, .events = POLLIN},
            {.fd = cancel_fd, .events = POLLIN},
        };
        int ready;
        pid_t waited = waitpid(child_pid, child_status, WNOHANG);

        if (waited == child_pid) {
            *child_reaped = 1;
            errno = ECHILD;
            return -1;
        }
        if (waited < 0) {
            return -1;
        }
        if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
            return -1;
        }
        {
            int64_t remaining_ns =
                deadline_ns - ((int64_t)now.tv_sec * 1000000000LL + now.tv_nsec);
            int timeout_ms;

            if (remaining_ns <= 0) {
                errno = ETIMEDOUT;
                return -1;
            }
            timeout_ms = (int)((remaining_ns + 999999LL) / 1000000LL);
            if (timeout_ms > 50) {
                timeout_ms = 50;
            }
            ready = poll(poll_fds, 2, timeout_ms);
        }
        if (ready < 0 && errno == EINTR) {
            continue;
        }
        if (ready < 0) {
            return -1;
        }
        if (poll_fds[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            errno = ECANCELED;
            return 0;
        }
        if (poll_fds[0].revents & POLLIN) {
            uint8_t event = 0;

            if (read(ready_fd, &event, sizeof(event)) == sizeof(event) &&
                event == CHILD_READY) {
                waited = waitpid(child_pid, child_status, WNOHANG);
                if (waited == child_pid) {
                    *child_reaped = 1;
                    errno = ECHILD;
                    return -1;
                }
                return waited < 0 ? -1 : 1;
            }
            return -1;
        }
        if (poll_fds[0].revents & (POLLHUP | POLLERR | POLLNVAL)) {
            errno = ECHILD;
            return -1;
        }
    }
}

static int stop_worker_child(pid_t child_pid, int stop_fd, int *child_reaped,
                             int *child_status, int *forced)
{
    uint8_t stop = 1;
    int wait_result;

    if (stop_fd >= 0) {
        write(stop_fd, &stop, sizeof(stop));
        close(stop_fd);
    }
    if (!*child_reaped) {
        wait_result =
            wait_for_child_exit(child_pid, WORKER_STOP_TIMEOUT_MS, child_status);
        if (wait_result == 1) {
            *child_reaped = 1;
        } else {
            *forced = 1;
            if (kill(child_pid, SIGTERM) != 0 && errno != ESRCH) {
                return -1;
            }
            wait_result = wait_for_child_exit(child_pid, WORKER_TERM_TIMEOUT_MS,
                                              child_status);
            if (wait_result == 1) {
                *child_reaped = 1;
            } else {
                if (kill(child_pid, SIGKILL) != 0 && errno != ESRCH) {
                    return -1;
                }
                wait_result = wait_for_child_exit(
                    child_pid, WORKER_KILL_TIMEOUT_MS, child_status);
                if (wait_result != 1) {
                    return -1;
                }
                *child_reaped = 1;
            }
        }
    }
    return WIFEXITED(*child_status) && WEXITSTATUS(*child_status) == 0 &&
                   !*forced
               ? 0
               : -1;
}

static int create_worker_pipe(int pipe_fds[2], int nonblocking_write)
{
    int read_flags;
    int write_flags;

    if (pipe(pipe_fds) != 0) {
        return -1;
    }
    read_flags = fcntl(pipe_fds[0], F_GETFD);
    write_flags = fcntl(pipe_fds[1], F_GETFD);
    if (read_flags < 0 || write_flags < 0 ||
        fcntl(pipe_fds[0], F_SETFD, read_flags | FD_CLOEXEC) != 0 ||
        fcntl(pipe_fds[1], F_SETFD, write_flags | FD_CLOEXEC) != 0 ||
        (nonblocking_write &&
         fcntl(pipe_fds[1], F_SETFL, O_NONBLOCK) != 0)) {
        close(pipe_fds[0]);
        close(pipe_fds[1]);
        pipe_fds[0] = -1;
        pipe_fds[1] = -1;
        return -1;
    }
    return 0;
}

static int run_session(int control_fd, uid_t owner_uid)
{
    struct BySpaceTunnelRequest request;
    struct BySpaceMacosTunnel tunnel;
    char worker_config[2048];
    char error[256];
    int signal_pipe[2] = {-1, -1};
    int worker_stop_pipe[2] = {-1, -1};
    int worker_ready_pipe[2] = {-1, -1};
    pid_t worker_pid = -1;
    int child_reaped = 0;
    int child_status = 0;
    int worker_forced = 0;
    int session_failed = 0;
    int tunnel_open = 0;
    int stop_requested = 0;
    int control_alive = 1;
    int result = 1;
    int request_result;

    if (install_signal_handlers(signal_pipe) != 0) {
        return 1;
    }
    request_result =
        read_request(control_fd, signal_pipe[0], &request, error, sizeof(error));
    if (request_result <= 0) {
        if (request_result == 0 || request_result == -2) {
            result = 0;
        } else {
            send_error(control_fd, error);
        }
        goto cleanup;
    }
    if (request.opcode != BYSPACE_TUNNEL_OPCODE_START) {
        send_error(control_fd, "first control request must be START");
        goto cleanup;
    }

    if (snprintf(worker_config, sizeof(worker_config),
                 "tunnel:\n"
                 "  mtu: %u\n"
                 "  multi-queue: false\n"
                 "  icmp: 'off'\n"
                 "socks5:\n"
                 "  address: 127.0.0.1\n"
                 "  port: %u\n"
                 "  udp: 'tcp'\n"
                 "misc:\n"
                 "  task-stack-size: 86016\n"
                 "  tcp-buffer-size: 65536\n"
                 "  max-session-count: 128\n"
                 "  connect-timeout: 10000\n"
                 "  tcp-read-write-timeout: 300000\n"
                 "  log-level: warn\n",
                 request.mtu, request.socks_port) >=
        (int)sizeof(worker_config)) {
        send_error(control_fd, "HEV configuration is too long");
        goto cleanup;
    }

    tunnel_open = 1;
    if (byspace_macos_tunnel_open(&tunnel, request.local_ipv4,
                                  request.peer_ipv4, request.mtu, error,
                                  sizeof(error)) != 0) {
        send_error(control_fd, error);
        session_failed = 1;
        goto stop_worker;
    }

    if (create_worker_pipe(worker_stop_pipe, 1) != 0 ||
        create_worker_pipe(worker_ready_pipe, 1) != 0) {
        send_error(control_fd, "create worker control pipes");
        session_failed = 1;
        goto stop_worker;
    }
    worker_pid = fork();
    if (worker_pid < 0) {
        send_error(control_fd, "fork HEV worker");
        session_failed = 1;
        goto stop_worker;
    }
    if (worker_pid == 0) {
        int child_result;

        signal_pipe_write_fd = -1;
        close(control_fd);
        close(signal_pipe[0]);
        close(signal_pipe[1]);
        close(worker_stop_pipe[1]);
        close(worker_ready_pipe[0]);
        child_result = run_worker_child(
            worker_config, tunnel.fd, worker_stop_pipe[0], worker_ready_pipe[1],
            owner_uid);
        close(worker_stop_pipe[0]);
        close(worker_ready_pipe[1]);
        _exit(child_result);
    }
    close(worker_stop_pipe[0]);
    worker_stop_pipe[0] = -1;
    close(worker_ready_pipe[1]);
    worker_ready_pipe[1] = -1;

    request_result = wait_for_child_ready(
        worker_pid, worker_ready_pipe[0], signal_pipe[0], &child_reaped,
        &child_status);
    if (request_result == 0) {
        goto stop_worker;
    }
    if (request_result < 0) {
        send_error(control_fd, "HEV worker did not become ready");
        session_failed = 1;
        goto stop_worker;
    }
    if (send_ready(control_fd, &tunnel, request.peer_ipv4) != 0) {
        session_failed = 1;
        goto stop_worker;
    }

    while (!stop_requested) {
        struct pollfd poll_fds[2] = {
            {.fd = control_fd, .events = POLLIN},
            {.fd = signal_pipe[0], .events = POLLIN},
        };
        pid_t waited = waitpid(worker_pid, &child_status, WNOHANG);
        int ready;

        if (waited == worker_pid) {
            child_reaped = 1;
            send_error(control_fd, "HEV worker exited unexpectedly");
            session_failed = 1;
            goto stop_worker;
        }
        if (waited < 0) {
            session_failed = 1;
            goto stop_worker;
        }
        ready = poll(poll_fds, 2, 100);
        if (ready < 0 && errno == EINTR) {
            continue;
        }
        if (ready < 0) {
            session_failed = 1;
            goto stop_worker;
        }
        if (ready == 0) {
            continue;
        }
        if (poll_fds[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            uint8_t signal_value;

            read(signal_pipe[0], &signal_value, sizeof(signal_value));
            stop_requested = 1;
            continue;
        }
        if (poll_fds[0].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            request_result = read_request(control_fd, signal_pipe[0], &request,
                                          error, sizeof(error));
            if (request_result == 0) {
                control_alive = 0;
                stop_requested = 1;
            } else if (request_result == -2) {
                stop_requested = 1;
            } else if (request_result < 0) {
                send_error(control_fd, error);
                session_failed = 1;
                stop_requested = 1;
            } else if (request.opcode == BYSPACE_TUNNEL_OPCODE_STOP) {
                stop_requested = 1;
            } else {
                send_error(control_fd, "only STOP is valid after START");
                session_failed = 1;
                stop_requested = 1;
            }
        }
    }

stop_worker:
    if (worker_ready_pipe[0] >= 0) {
        close(worker_ready_pipe[0]);
        worker_ready_pipe[0] = -1;
    }
    if (worker_pid > 0 &&
        stop_worker_child(worker_pid, worker_stop_pipe[1], &child_reaped,
                          &child_status, &worker_forced) != 0) {
        send_error(control_fd, worker_forced ? "HEV worker required forced termination"
                                             : "HEV worker failed");
        session_failed = 1;
    }
    worker_stop_pipe[1] = -1;
    if (tunnel_open && byspace_macos_tunnel_close(&tunnel) != 0) {
        send_error(control_fd, "utun or peer route cleanup failed");
        session_failed = 1;
    }
    if (!session_failed &&
        (!control_alive ||
         send_frame(control_fd, BYSPACE_TUNNEL_OPCODE_STOPPED, NULL, 0) == 0)) {
        result = 0;
    }

cleanup:
    if (worker_stop_pipe[0] >= 0) {
        close(worker_stop_pipe[0]);
    }
    if (worker_stop_pipe[1] >= 0) {
        close(worker_stop_pipe[1]);
    }
    if (worker_ready_pipe[0] >= 0) {
        close(worker_ready_pipe[0]);
    }
    if (worker_ready_pipe[1] >= 0) {
        close(worker_ready_pipe[1]);
    }
    signal_pipe_write_fd = -1;
    if (signal_pipe[0] >= 0) {
        close(signal_pipe[0]);
        close(signal_pipe[1]);
    }
    return result;
}

static int close_inherited_fds(void)
{
    DIR *directory = opendir("/dev/fd");
    struct dirent *entry;
    int directory_fd;
    int result;

    if (directory == NULL) {
        return -1;
    }
    directory_fd = dirfd(directory);
    while ((entry = readdir(directory)) != NULL) {
        char *end = NULL;
        long fd;

        errno = 0;
        fd = strtol(entry->d_name, &end, 10);
        if (errno != 0 || end == entry->d_name || *end != '\0' ||
            fd <= STDERR_FILENO || fd == directory_fd || fd > INT_MAX) {
            continue;
        }
        close((int)fd);
    }
    result = closedir(directory);
    return result;
}

static int ensure_output_fds(void)
{
    int fd;

    for (fd = STDOUT_FILENO; fd <= STDERR_FILENO; fd++) {
        if (fcntl(fd, F_GETFD) >= 0) {
            continue;
        }
        if (errno != EBADF) {
            return -1;
        }
        {
            int null_fd = open("/dev/null", O_WRONLY);

            if (null_fd < 0) {
                return -1;
            }
            if (null_fd != fd) {
                if (dup2(null_fd, fd) < 0) {
                    close(null_fd);
                    return -1;
                }
                close(null_fd);
            }
        }
    }
    return 0;
}

int main(int argc, char **argv)
{
    uid_t owner_uid;
    char error[256];

    if (argc != 3 || strcmp(argv[1], "--owner-uid") != 0 ||
        parse_owner_uid(argv[2], &owner_uid) != 0 || owner_uid == 0) {
        fprintf(stderr, "usage: %s --owner-uid UID\n", argv[0]);
        return 64;
    }
    if (geteuid() != 0) {
        fprintf(stderr, "the tunnel helper must run as root\n");
        return 77;
    }
    if (ensure_output_fds() != 0) {
        return 78;
    }
    if (authenticate_control_fd(STDIN_FILENO, owner_uid, error, sizeof(error)) !=
        0) {
        fprintf(stderr, "%s\n", error);
        return 78;
    }
    if (close_inherited_fds() != 0) {
        fprintf(stderr, "cannot close inherited file descriptors\n");
        return 78;
    }
    return run_session(STDIN_FILENO, owner_uid);
}
