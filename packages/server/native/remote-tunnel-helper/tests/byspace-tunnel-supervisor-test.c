#define main byspace_tunnel_supervisor_program_main
#include "../src/byspace-tunnel-supervisor.c"
#undef main

#include <poll.h>

static void sleep_milliseconds(long milliseconds)
{
    struct timespec delay = {
        .tv_sec = milliseconds / 1000,
        .tv_nsec = (milliseconds % 1000) * 1000000L,
    };

    nanosleep(&delay, NULL);
}

static int connect_to_listener(const char *socket_path)
{
    struct sockaddr_un address;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);

    if (fd < 0) {
        return -1;
    }
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, socket_path, strlen(socket_path) + 1);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static int connect_with_retry(const char *socket_path)
{
    for (int attempt = 0; attempt < 100; attempt++) {
        int fd = connect_to_listener(socket_path);

        if (fd >= 0) {
            return fd;
        }
        sleep_milliseconds(20);
    }
    return -1;
}

static int client_observes_eof(const char *socket_path)
{
    struct pollfd polled;
    char byte;
    int fd = connect_to_listener(socket_path);
    int ready;

    if (fd < 0) {
        return 1;
    }
    polled.fd = fd;
    polled.events = POLLIN | POLLHUP;
    polled.revents = 0;
    ready = poll(&polled, 1, 2000);
    if (ready <= 0 || read(fd, &byte, sizeof(byte)) != 0) {
        close(fd);
        return 1;
    }
    close(fd);
    return 0;
}

static int write_persistent_helper(const char *helper_path, const char *pid_path)
{
    static const char helper_template[] =
        "#!/bin/sh\n"
        "echo $$ > %s\n"
        "exec /usr/bin/tail -f /dev/null\n";
    char contents[PATH_MAX + 128];
    int fd;
    int length;

    length = snprintf(contents, sizeof(contents), helper_template, pid_path);
    if (length < 0 || (size_t)length >= sizeof(contents)) {
        return -1;
    }
    fd = open(helper_path, O_WRONLY | O_CREAT | O_TRUNC, 0700);
    if (fd < 0) {
        return -1;
    }
    if (write(fd, contents, (size_t)length) != length || close(fd) != 0) {
        close(fd);
        return -1;
    }
    return chmod(helper_path, 0700);
}

static int wait_for_pid_file(const char *pid_path, pid_t *helper_pid)
{
    char contents[32];

    for (int attempt = 0; attempt < 100; attempt++) {
        int fd = open(pid_path, O_RDONLY);
        ssize_t length;
        char *end;
        unsigned long parsed;

        if (fd >= 0) {
            length = read(fd, contents, sizeof(contents) - 1);
            close(fd);
            if (length > 0) {
                contents[length] = '\0';
                if (contents[length - 1] == '\n') {
                    contents[length - 1] = '\0';
                }
                errno = 0;
                parsed = strtoul(contents, &end, 10);
                if (errno == 0 && end != contents && *end == '\0' && parsed > 0 &&
                    parsed <= INT_MAX) {
                    *helper_pid = (pid_t)parsed;
                    return 0;
                }
            }
        }
        sleep_milliseconds(20);
    }
    return -1;
}

static void reap_runner(pid_t runner_pid)
{
    int status;

    for (int attempt = 0; attempt < 100; attempt++) {
        pid_t waited = waitpid(runner_pid, &status, WNOHANG);

        if (waited == runner_pid) {
            return;
        }
        if (waited < 0 && errno != EINTR) {
            return;
        }
        sleep_milliseconds(20);
    }
    (void)kill(runner_pid, SIGKILL);
    (void)waitpid(runner_pid, &status, 0);
}

static void remove_test_files(const char *socket_path, const char *helper_path,
                              const char *pid_path)
{
    unlink(socket_path);
    unlink(helper_path);
    unlink(pid_path);
}

static int test_unexpected_helper_exit(const char *directory)
{
    char socket_path[PATH_MAX];
    int listener_fd;
    pid_t client_pid;
    int client_status = 0;
    int session_result;

    if (snprintf(socket_path, sizeof(socket_path), "%s/exit.sock", directory) >=
        (int)sizeof(socket_path)) {
        fprintf(stderr, "unexpected-exit socket path is too long\n");
        return 1;
    }
    listener_fd = create_listener(socket_path, getuid());
    if (listener_fd < 0) {
        fprintf(stderr, "unexpected-exit listener failed: %s\n", strerror(errno));
        return 1;
    }
    client_pid = fork();
    if (client_pid < 0) {
        close(listener_fd);
        unlink(socket_path);
        return 1;
    }
    if (client_pid == 0) {
        _exit(client_observes_eof(socket_path));
    }

    session_result = run_session(listener_fd, "/usr/bin/true", getuid());
    if (waitpid(client_pid, &client_status, 0) != client_pid) {
        client_status = 1;
    }
    close(listener_fd);
    unlink(socket_path);

    if (session_result != 0 || !WIFEXITED(client_status) || WEXITSTATUS(client_status) != 0) {
        fprintf(stderr, "unexpected helper exit did not close the client socket\n");
        return 1;
    }
    return 0;
}

static int test_persistent_helper(const char *directory)
{
    char helper_path[PATH_MAX];
    char pid_path[PATH_MAX];
    char socket_path[PATH_MAX];
    struct pollfd polled;
    pid_t helper_pid = -1;
    pid_t runner_pid;
    int client_fd = -1;
    int listener_fd = -1;
    int ready;
    char byte;

    if (snprintf(helper_path, sizeof(helper_path), "%s/persistent-helper", directory) >=
            (int)sizeof(helper_path) ||
        snprintf(pid_path, sizeof(pid_path), "%s/helper.pid", directory) >=
            (int)sizeof(pid_path) ||
        snprintf(socket_path, sizeof(socket_path), "%s/persistent.sock", directory) >=
            (int)sizeof(socket_path) ||
        write_persistent_helper(helper_path, pid_path) != 0) {
        fprintf(stderr, "persistent helper setup failed\n");
        return 1;
    }
    listener_fd = create_listener(socket_path, getuid());
    if (listener_fd < 0) {
        fprintf(stderr, "persistent listener failed: %s\n", strerror(errno));
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }
    runner_pid = fork();
    if (runner_pid < 0) {
        fprintf(stderr, "persistent runner fork failed: %s\n", strerror(errno));
        close(listener_fd);
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }
    if (runner_pid == 0) {
        (void)install_signal_handlers();
        (void)run_session(listener_fd, helper_path, getuid());
        _exit(0);
    }
    client_fd = connect_with_retry(socket_path);
    if (client_fd < 0 || wait_for_pid_file(pid_path, &helper_pid) != 0) {
        fprintf(stderr, "persistent session did not start\n");
        if (helper_pid > 0) {
            (void)kill(helper_pid, SIGKILL);
        }
        (void)kill(runner_pid, SIGTERM);
        reap_runner(runner_pid);
        if (client_fd >= 0) {
            close(client_fd);
        }
        close(listener_fd);
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }

    polled.fd = client_fd;
    polled.events = POLLIN | POLLHUP;
    polled.revents = 0;
    ready = poll(&polled, 1, 7000);
    if (ready != 0) {
        fprintf(stderr, "supervisor killed a healthy session before shutdown\n");
        (void)kill(helper_pid, SIGKILL);
        (void)kill(runner_pid, SIGKILL);
        reap_runner(runner_pid);
        close(client_fd);
        close(listener_fd);
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }

    (void)kill(runner_pid, SIGTERM);
    reap_runner(runner_pid);
    ready = poll(&polled, 1, 2000);
    if (ready <= 0 || read(client_fd, &byte, sizeof(byte)) != 0) {
        fprintf(stderr, "supervisor did not close the session after shutdown\n");
        (void)kill(helper_pid, SIGKILL);
        close(client_fd);
        close(listener_fd);
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }
    if (kill(helper_pid, 0) == 0) {
        fprintf(stderr, "supervisor left the persistent helper alive\n");
        (void)kill(helper_pid, SIGKILL);
        close(client_fd);
        close(listener_fd);
        remove_test_files(socket_path, helper_path, pid_path);
        return 1;
    }
    close(client_fd);
    close(listener_fd);
    remove_test_files(socket_path, helper_path, pid_path);
    return 0;
}

int main(void)
{
    char temporary[] = "/tmp/byspace-supervisor-test.XXXXXX";
    char *directory = mkdtemp(temporary);
    int result = directory == NULL ? 1 : test_unexpected_helper_exit(directory);

    if (result == 0) {
        result = test_persistent_helper(directory);
    }
    if (directory != NULL) {
        rmdir(directory);
    }
    if (result != 0) {
        return 1;
    }
    puts("remote tunnel supervisor lifecycle passed");
    return 0;
}
