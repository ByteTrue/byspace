#define _DARWIN_C_SOURCE 1

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stop_requested = 0;
static volatile sig_atomic_t active_child = -1;

static void handle_signal(int signal_number)
{
    pid_t child = (pid_t)active_child;
    (void)signal_number;
    stop_requested = 1;
    if (child > 0) {
        (void)kill(child, SIGTERM);
    }
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

static int install_signal_handlers(void)
{
    struct sigaction action;

    memset(&action, 0, sizeof(action));
    sigemptyset(&action.sa_mask);
    action.sa_handler = handle_signal;
    if (sigaction(SIGTERM, &action, NULL) != 0 ||
        sigaction(SIGINT, &action, NULL) != 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR) {
        return -1;
    }
    return 0;
}

static int set_close_on_exec(int fd)
{
    int flags = fcntl(fd, F_GETFD);

    if (flags < 0 || fcntl(fd, F_SETFD, flags | FD_CLOEXEC) != 0) {
        return -1;
    }
    return 0;
}

static int remove_stale_socket(const char *path, uid_t owner_uid)
{
    struct stat status;

    if (lstat(path, &status) != 0) {
        return errno == ENOENT ? 0 : -1;
    }
    if (!S_ISSOCK(status.st_mode) ||
        (status.st_uid != 0 && status.st_uid != owner_uid)) {
        errno = EEXIST;
        return -1;
    }
    return unlink(path);
}

static int create_listener(const char *path, uid_t owner_uid)
{
    struct sockaddr_un address;
    int fd;
    mode_t previous_umask;

    if (strlen(path) >= sizeof(address.sun_path)) {
        errno = ENAMETOOLONG;
        return -1;
    }
    if (remove_stale_socket(path, owner_uid) != 0) {
        return -1;
    }
    fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return -1;
    }
    if (set_close_on_exec(fd) != 0) {
        close(fd);
        return -1;
    }
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, path, strlen(path) + 1);
    previous_umask = umask(077);
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        umask(previous_umask);
        close(fd);
        return -1;
    }
    umask(previous_umask);
    if (chmod(path, S_IRUSR | S_IWUSR) != 0 ||
        chown(path, owner_uid, (gid_t)-1) != 0 || listen(fd, 1) != 0) {
        unlink(path);
        close(fd);
        return -1;
    }
    return fd;
}

static int resolve_sibling_helper(const char *program, char *path, size_t path_size)
{
    char resolved[PATH_MAX];
    char *separator;

    if (realpath(program, resolved) == NULL) {
        return -1;
    }
    separator = strrchr(resolved, '/');
    if (separator == NULL ||
        (size_t)(separator - resolved) + strlen("/byspace-tunnel-helper") + 1 >
            path_size) {
        errno = ENAMETOOLONG;
        return -1;
    }
    *separator = '\0';
    if (snprintf(path, path_size, "%s/byspace-tunnel-helper", resolved) >=
        (int)path_size) {
        errno = ENAMETOOLONG;
        return -1;
    }
    return 0;
}

static int wait_for_session(pid_t child_pid)
{
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 20000000};
    int status = 0;
    int shutdown_elapsed_ms = -1;

    for (;;) {
        pid_t waited = waitpid(child_pid, &status, WNOHANG);

        if (waited == child_pid) {
            active_child = -1;
            return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : -1;
        }
        if (waited < 0 && errno != EINTR) {
            active_child = -1;
            return -1;
        }
        if (stop_requested && shutdown_elapsed_ms < 0) {
            shutdown_elapsed_ms = 0;
            if (kill(child_pid, SIGTERM) != 0 && errno != ESRCH) {
                active_child = -1;
                return -1;
            }
        }
        if (shutdown_elapsed_ms >= 6000) {
            break;
        }
        nanosleep(&delay, NULL);
        if (shutdown_elapsed_ms >= 0) {
            shutdown_elapsed_ms += 20;
        }
    }

    if (kill(child_pid, SIGKILL) != 0 && errno != ESRCH) {
        active_child = -1;
        return -1;
    }
    shutdown_elapsed_ms = 0;
    while (shutdown_elapsed_ms < 1000) {
        pid_t waited = waitpid(child_pid, &status, WNOHANG);

        if (waited == child_pid) {
            active_child = -1;
            return -1;
        }
        if (waited < 0 && errno != EINTR) {
            active_child = -1;
            return -1;
        }
        nanosleep(&delay, NULL);
        shutdown_elapsed_ms += 20;
    }
    active_child = -1;
    return -1;
}

static int run_session(int listener_fd, const char *helper_path, uid_t owner_uid)
{
    char owner_uid_text[32];
    int control_fd;
    pid_t child_pid;

    control_fd = accept(listener_fd, NULL, NULL);
    if (control_fd < 0) {
        return errno == EINTR && stop_requested ? 1 : -1;
    }
    if (set_close_on_exec(control_fd) != 0) {
        close(control_fd);
        return -1;
    }
    if (snprintf(owner_uid_text, sizeof(owner_uid_text), "%u", owner_uid) >=
        (int)sizeof(owner_uid_text)) {
        close(control_fd);
        return -1;
    }
    child_pid = fork();
    if (child_pid < 0) {
        close(control_fd);
        return -1;
    }
    if (child_pid == 0) {
        if (dup2(control_fd, STDIN_FILENO) < 0) {
            _exit(126);
        }
        if (control_fd != STDIN_FILENO) {
            close(control_fd);
        }
        execl(helper_path, helper_path, "--owner-uid", owner_uid_text, (char *)NULL);
        _exit(127);
    }
    close(control_fd);
    active_child = child_pid;
    if (stop_requested) {
        (void)kill(child_pid, SIGTERM);
    }
    return wait_for_session(child_pid);
}

int main(int argc, char **argv)
{
    const char *socket_path = NULL;
    uid_t owner_uid;
    char helper_path[PATH_MAX];
    int listener_fd;

    if (argc != 5 || strcmp(argv[1], "--owner-uid") != 0 ||
        strcmp(argv[3], "--socket") != 0 ||
        parse_owner_uid(argv[2], &owner_uid) != 0 || owner_uid == 0) {
        fprintf(stderr, "usage: %s --owner-uid UID --socket PATH\n", argv[0]);
        return 64;
    }
    socket_path = argv[4];
    if (socket_path[0] != '/') {
        fprintf(stderr, "socket path must be absolute\n");
        return 64;
    }
    if (geteuid() != 0) {
        fprintf(stderr, "the tunnel supervisor must run as root\n");
        return 77;
    }
    if (resolve_sibling_helper(argv[0], helper_path, sizeof(helper_path)) != 0) {
        fprintf(stderr, "cannot resolve sibling tunnel helper\n");
        return 78;
    }
    if (access(helper_path, X_OK) != 0) {
        fprintf(stderr, "sibling tunnel helper is unavailable\n");
        return 78;
    }
    if (install_signal_handlers() != 0) {
        return 78;
    }
    listener_fd = create_listener(socket_path, owner_uid);
    if (listener_fd < 0) {
        perror("create supervisor socket");
        return 78;
    }
    while (!stop_requested) {
        int result = run_session(listener_fd, helper_path, owner_uid);

        if (result < 0 && !stop_requested) {
            fprintf(stderr, "tunnel session failed; supervisor remains available\n");
        }
    }
    close(listener_fd);
    unlink(socket_path);
    return 0;
}
