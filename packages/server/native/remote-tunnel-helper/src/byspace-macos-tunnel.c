#include "byspace-macos-tunnel.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/wait.h>
#include <sys/uio.h>
#include <unistd.h>
#include <hev-task.h>
#include <hev-task-io.h>
#include <hev-tunnel.h>

struct RouteInfo {
    int exact;
    char interface_name[IFNAMSIZ];
};

static char *route_environment[] = {
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
    "LC_ALL=C",
    NULL,
};

static int fail(char *error, size_t error_size, const char *message)
{
    if (error_size > 0) {
        snprintf(error, error_size, "%s", message);
    }
    return -1;
}

static int fail_errno(char *error, size_t error_size, const char *operation)
{
    if (error_size > 0) {
        snprintf(error, error_size, "%s: %s", operation, strerror(errno));
    }
    return -1;
}

static int move_fd_above_standard(int fd)
{
    int moved_fd;
    int flags;

    if (fd <= STDERR_FILENO) {
        moved_fd = fcntl(fd, F_DUPFD_CLOEXEC, STDERR_FILENO + 1);
        if (moved_fd < 0) {
            return -1;
        }
        close(fd);
        return moved_fd;
    }
    flags = fcntl(fd, F_GETFD);
    if (flags < 0 || fcntl(fd, F_SETFD, flags | FD_CLOEXEC) != 0) {
        return -1;
    }
    return fd;
}

static int kill_and_reap(pid_t process_id, int *status)
{
    struct timespec started;
    int64_t deadline_ns;

    if (kill(process_id, SIGKILL) != 0 && errno != ESRCH) {
        return -1;
    }
    if (clock_gettime(CLOCK_MONOTONIC, &started) != 0) {
        return -1;
    }
    deadline_ns = (int64_t)started.tv_sec * 1000000000LL + started.tv_nsec +
                  1000000000LL;
    for (;;) {
        struct timespec now;
        struct timespec delay = {.tv_sec = 0, .tv_nsec = 20000000};
        pid_t waited = waitpid(process_id, status, WNOHANG);

        if (waited == process_id) {
            return 0;
        }
        if (waited < 0 && errno != EINTR) {
            return -1;
        }
        if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
            return -1;
        }
        if ((int64_t)now.tv_sec * 1000000000LL + now.tv_nsec >= deadline_ns) {
            errno = ETIMEDOUT;
            return -1;
        }
        nanosleep(&delay, NULL);
    }
}

static int run_route(char *const arguments[], char *output, size_t output_size)
{
    posix_spawn_file_actions_t actions;
    pid_t process_id;
    int output_pipe[2] = {-1, -1};
    int capture_output = output != NULL && output_size > 0;
    int read_failed = 0;
    int status;
    int result;

    result = posix_spawn_file_actions_init(&actions);
    if (result != 0) {
        errno = result;
        return -1;
    }

    result = posix_spawn_file_actions_addopen(
        &actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    if (result != 0) {
        goto actions_failed;
    }
    if (capture_output) {
        if (pipe(output_pipe) != 0) {
            posix_spawn_file_actions_destroy(&actions);
            return -1;
        }
        {
            int moved_fd = move_fd_above_standard(output_pipe[0]);

            if (moved_fd < 0) {
                int saved_errno = errno;
                posix_spawn_file_actions_destroy(&actions);
                close(output_pipe[0]);
                close(output_pipe[1]);
                errno = saved_errno;
                return -1;
            }
            output_pipe[0] = moved_fd;
            moved_fd = move_fd_above_standard(output_pipe[1]);
            if (moved_fd < 0) {
                int saved_errno = errno;
                posix_spawn_file_actions_destroy(&actions);
                close(output_pipe[0]);
                close(output_pipe[1]);
                errno = saved_errno;
                return -1;
            }
            output_pipe[1] = moved_fd;
        }
        result = posix_spawn_file_actions_adddup2(&actions, output_pipe[1],
                                                   STDOUT_FILENO);
        if (result == 0) {
            result =
                posix_spawn_file_actions_addclose(&actions, output_pipe[0]);
        }
        if (result == 0) {
            result =
                posix_spawn_file_actions_addclose(&actions, output_pipe[1]);
        }
        if (result != 0) {
            goto actions_failed;
        }
    } else {
        result = posix_spawn_file_actions_addopen(
            &actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
        if (result != 0) {
            goto actions_failed;
        }
    }
    result = posix_spawn_file_actions_addopen(
        &actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
    if (result != 0) {
        goto actions_failed;
    }

    result = posix_spawn(&process_id, "/sbin/route", &actions, NULL, arguments,
                         route_environment);
    posix_spawn_file_actions_destroy(&actions);
    if (output_pipe[1] >= 0) {
        close(output_pipe[1]);
    }
    if (result != 0) {
        if (output_pipe[0] >= 0) {
            close(output_pipe[0]);
        }
        errno = result;
        return -1;
    }

    {
        struct timespec now;
        int64_t deadline_ns;
        int child_exited = 0;
        int output_eof = !capture_output;
        size_t used = 0;

        if (capture_output &&
            fcntl(output_pipe[0], F_SETFL, O_NONBLOCK) != 0) {
            read_failed = 1;
        }
        if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
            read_failed = 1;
            deadline_ns = 0;
        } else {
            deadline_ns =
                (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec + 5000000000LL;
        }

        while ((!child_exited || !output_eof) && !read_failed) {
            if (!output_eof) {
                struct pollfd output_event = {
                    .fd = output_pipe[0], .events = POLLIN};
                int poll_result = poll(&output_event, 1, 20);

                if (poll_result < 0 && errno != EINTR) {
                    read_failed = 1;
                } else if (poll_result > 0 &&
                           (output_event.revents &
                            (POLLIN | POLLHUP | POLLERR | POLLNVAL))) {
                    uint8_t buffer[256];

                    for (;;) {
                        ssize_t bytes_read =
                            read(output_pipe[0], buffer, sizeof(buffer));

                        if (bytes_read > 0) {
                            size_t available = output_size - used - 1;
                            size_t copy_size = (size_t)bytes_read;

                            if (copy_size > available) {
                                copy_size = available;
                            }
                            if (copy_size > 0) {
                                memcpy(output + used, buffer, copy_size);
                                used += copy_size;
                            }
                            continue;
                        }
                        if (bytes_read == 0) {
                            output_eof = 1;
                            break;
                        }
                        if (errno == EINTR) {
                            continue;
                        }
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            break;
                        }
                        read_failed = 1;
                        break;
                    }
                }
            } else if (!child_exited) {
                struct timespec delay = {.tv_sec = 0, .tv_nsec = 20000000};

                nanosleep(&delay, NULL);
            }

            if (!child_exited) {
                result = waitpid(process_id, &status, WNOHANG);
                if (result == process_id) {
                    child_exited = 1;
                } else if (result < 0) {
                    read_failed = 1;
                }
            }
            if (clock_gettime(CLOCK_MONOTONIC, &now) != 0 ||
                (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec > deadline_ns) {
                if (!child_exited &&
                    kill_and_reap(process_id, &status) == 0) {
                    child_exited = 1;
                }
                errno = ETIMEDOUT;
                read_failed = 1;
            }
        }
        if (read_failed && !child_exited) {
            if (kill_and_reap(process_id, &status) == 0) {
                child_exited = 1;
            }
        }
        if (capture_output) {
            output[used] = '\0';
            close(output_pipe[0]);
        }
        if (read_failed || !child_exited || !WIFEXITED(status) ||
            WEXITSTATUS(status) != 0) {
            return -1;
        }
    }
    return 0;

actions_failed:
    posix_spawn_file_actions_destroy(&actions);
    if (output_pipe[0] >= 0) {
        close(output_pipe[0]);
        close(output_pipe[1]);
    }
    errno = result;
    return -1;
}

static int get_route_info(const char *peer_ipv4, struct RouteInfo *route)
{
    char output[2048];
    char *arguments[] = {"/sbin/route", "-n", "get", (char *)peer_ipv4, NULL};
    char *line;
    char *line_context = NULL;
    char destination[64] = "";

    memset(route, 0, sizeof(*route));
    if (run_route(arguments, output, sizeof(output)) != 0) {
        return -1;
    }

    line = strtok_r(output, "\n", &line_context);
    while (line != NULL) {
        char *trimmed = line;

        while (*trimmed == ' ' || *trimmed == '\t') {
            trimmed++;
        }
        if (sscanf(trimmed, "destination: %63s", destination) == 1) {
            line = strtok_r(NULL, "\n", &line_context);
            continue;
        }
        if (sscanf(trimmed, "interface: %15s", route->interface_name) == 1) {
            line = strtok_r(NULL, "\n", &line_context);
            continue;
        }
        line = strtok_r(NULL, "\n", &line_context);
    }

    route->exact = strcmp(destination, peer_ipv4) == 0;
    return 0;
}

static int inspect_owned_route(const char *peer_ipv4,
                               const char *interface_name)
{
    struct RouteInfo route;
    int attempt;

    for (attempt = 0; attempt < 3; attempt++) {
        if (get_route_info(peer_ipv4, &route) == 0) {
            return route.exact &&
                           strcmp(route.interface_name, interface_name) == 0
                       ? 1
                       : 0;
        }
        if (attempt < 2) {
            usleep(20000);
        }
    }
    return -1;
}

static int add_route(const char *peer_ipv4, const char *interface_name)
{
    char *arguments[] = {"/sbin/route", "-n",       "add",       "-host",
                         (char *)peer_ipv4, "-interface", (char *)interface_name,
                         NULL};
    return run_route(arguments, NULL, 0);
}

static int delete_route(const char *peer_ipv4, const char *interface_name)
{
    char *arguments[] = {"/sbin/route", "-n",       "delete",    "-host",
                         (char *)peer_ipv4, "-interface", (char *)interface_name,
                         NULL};
    return run_route(arguments, NULL, 0);
}

int byspace_macos_tunnel_open(struct BySpaceMacosTunnel *tunnel,
                              uint32_t local_ipv4, uint32_t peer_ipv4,
                              uint16_t mtu, char *error, size_t error_size)
{
    char local_address[INET_ADDRSTRLEN];
    char peer_address[INET_ADDRSTRLEN];
    const char *interface_name;
    struct RouteInfo route;

    memset(tunnel, 0, sizeof(*tunnel));
    tunnel->fd = -1;
    tunnel->peer_ipv4 = peer_ipv4;

    if (inet_ntop(AF_INET, &local_ipv4, local_address, sizeof(local_address)) == NULL ||
        inet_ntop(AF_INET, &peer_ipv4, peer_address, sizeof(peer_address)) == NULL) {
        return fail_errno(error, error_size, "format IPv4 address");
    }
    if (get_route_info(peer_address, &route) != 0) {
        return fail(error, error_size, "inspect peer route");
    }
    if (route.exact) {
        return fail(error, error_size, "peer already has an exact route");
    }

    tunnel->fd = hev_tunnel_open("utun", 0);
    if (tunnel->fd < 0) {
        return fail_errno(error, error_size, "create utun");
    }
    {
        int flags = fcntl(tunnel->fd, F_GETFD);

        if (flags < 0 || fcntl(tunnel->fd, F_SETFD, flags | FD_CLOEXEC) != 0) {
            int saved_errno = errno;

            byspace_macos_tunnel_close(tunnel);
            errno = saved_errno;
            return fail_errno(error, error_size, "secure utun descriptor");
        }
    }

    interface_name = hev_tunnel_get_name();
    if (interface_name == NULL || strncmp(interface_name, "utun", 4) != 0 ||
        strlen(interface_name) >= sizeof(tunnel->interface_name)) {
        byspace_macos_tunnel_close(tunnel);
        return fail(error, error_size, "kernel returned an invalid utun name");
    }
    snprintf(tunnel->interface_name, sizeof(tunnel->interface_name), "%s",
             interface_name);

    if (hev_tunnel_set_mtu(mtu) != 0 ||
        hev_tunnel_set_ipv4(local_address, 32) != 0 ||
        hev_tunnel_set_state(1) != 0) {
        int saved_errno = errno;

        byspace_macos_tunnel_close(tunnel);
        errno = saved_errno;
        return fail_errno(error, error_size, "configure utun");
    }
    tunnel->route_added = 1;
    if (add_route(peer_address, tunnel->interface_name) != 0) {
        int saved_errno = errno;

        byspace_macos_tunnel_close(tunnel);
        errno = saved_errno;
        return fail_errno(error, error_size, "add peer route");
    }

    if (inspect_owned_route(peer_address, tunnel->interface_name) != 1) {
        byspace_macos_tunnel_close(tunnel);
        return fail(error, error_size, "verify peer route");
    }
    return 0;
}

int byspace_macos_tunnel_close(struct BySpaceMacosTunnel *tunnel)
{
    char peer_address[INET_ADDRSTRLEN];
    int has_peer_address;
    int clean = 1;

    has_peer_address =
        inet_ntop(AF_INET, &tunnel->peer_ipv4, peer_address,
                  sizeof(peer_address)) != NULL;
    if (tunnel->route_added && has_peer_address) {
        int owned =
            inspect_owned_route(peer_address, tunnel->interface_name);

        if (owned == 1) {
            delete_route(peer_address, tunnel->interface_name);
        } else if (owned == 0) {
            tunnel->route_added = 0;
        }
    }

    if (tunnel->fd >= 0) {
        hev_tunnel_close(tunnel->fd);
        tunnel->fd = -1;
    }
    if (tunnel->interface_name[0] != '\0' &&
        if_nametoindex(tunnel->interface_name) != 0) {
        clean = 0;
    }
    if (tunnel->route_added && has_peer_address) {
        int owned =
            inspect_owned_route(peer_address, tunnel->interface_name);

        if (owned == 1) {
            if (delete_route(peer_address, tunnel->interface_name) == 0) {
                owned = inspect_owned_route(peer_address, tunnel->interface_name);
            }
        }
        if (owned == 0) {
            tunnel->route_added = 0;
        } else {
            clean = 0;
        }
    }
    if (!has_peer_address) {
        clean = 0;
    }
    if (clean) {
        tunnel->interface_name[0] = '\0';
        tunnel->peer_ipv4 = 0;
    }
    return clean ? 0 : -1;
}
