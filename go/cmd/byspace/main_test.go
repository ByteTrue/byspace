package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"byspace/internal/daemon"
)

func TestDaemonCLI(t *testing.T) {
	binary := buildBinary(t)

	t.Run("lifecycle duplicate start and authorization", func(t *testing.T) {
		home := t.TempDir()
		t.Cleanup(func() { runCLI(binary, "daemon", "stop", "--home", home) })

		start := mustRunCLI(t, binary, "daemon", "start", "--home", home, "--listen", "127.0.0.1:0", "--json")
		var started daemon.Status
		decodeJSON(t, start.stdout, &started)
		if started.LocalDaemon != "running" || started.PID == nil {
			t.Fatalf("unexpected start status: %+v", started)
		}
		if runtime.GOOS != "windows" {
			assertPrivateMode(t, daemon.PIDPath(home), 0o600)
			assertPrivateMode(t, daemon.LogPath(home), 0o600)
			assertPrivateMode(t, filepath.Join(home, "daemon.lock"), 0o600)
		}

		statusResult := mustRunCLI(t, binary, "daemon", "status", "--home", home, "--json")
		var status daemon.Status
		decodeJSON(t, statusResult.stdout, &status)
		if status.ServerID != started.ServerID || status.LocalDaemon != "running" {
			t.Fatalf("unexpected status: %+v", status)
		}

		duplicate := runCLI(binary, "daemon", "start", "--home", home, "--listen", "127.0.0.1:0")
		if duplicate.code == 0 || !bytes.Contains(duplicate.stderr, []byte("already running")) {
			t.Fatalf("duplicate start = code %d, stderr %q", duplicate.code, duplicate.stderr)
		}

		record, err := daemon.ReadPIDRecord(home)
		if err != nil {
			t.Fatal(err)
		}
		response, err := httpPost("http://"+record.Listen+"/shutdown", "")
		if err != nil {
			t.Fatal(err)
		}
		if response != 401 {
			t.Fatalf("unauthorized shutdown status = %d", response)
		}

		stop := mustRunCLI(t, binary, "daemon", "stop", "--home", home, "--json")
		var stopped struct {
			Action string        `json:"action"`
			Status daemon.Status `json:"status"`
		}
		decodeJSON(t, stop.stdout, &stopped)
		if stopped.Action != "stopped" || stopped.Status.LocalDaemon != "stopped" {
			t.Fatalf("unexpected stop result: %+v", stopped)
		}
		if _, err := os.Stat(daemon.PIDPath(home)); !os.IsNotExist(err) {
			t.Fatalf("PID record still exists: %v", err)
		}
	})

	t.Run("concurrent stale reclamation has one owner", func(t *testing.T) {
		home := t.TempDir()
		writeRecord(t, home, os.Getpid(), "127.0.0.1:1")
		t.Cleanup(func() { runCLI(binary, "daemon", "stop", "--home", home) })

		const contenders = 8
		commands := make([]*exec.Cmd, contenders)
		outputs := make([]bytes.Buffer, contenders)
		for index := range commands {
			commands[index] = exec.Command(binary, "daemon", "start", "--home", home, "--listen", "127.0.0.1:0", "--json")
			commands[index].Stdout = &outputs[index]
			commands[index].Stderr = &outputs[index]
			if err := commands[index].Start(); err != nil {
				t.Fatal(err)
			}
		}
		successes := 0
		for index, command := range commands {
			if err := command.Wait(); err == nil {
				successes++
			} else if _, ok := err.(*exec.ExitError); !ok {
				t.Fatalf("contender %d failed unexpectedly: %v", index, err)
			}
		}
		if successes != 1 {
			t.Fatalf("concurrent starts had %d successes, want 1; outputs: %v", successes, outputs)
		}
		status := inspectWithCLI(t, binary, home)
		if status.LocalDaemon != "running" || status.PID == nil {
			t.Fatalf("unexpected owner after concurrent start: %+v", status)
		}
		mustRunCLI(t, binary, "daemon", "stop", "--home", home)
		if _, err := os.Stat(daemon.PIDPath(home)); !os.IsNotExist(err) {
			t.Fatalf("PID record remains after concurrent owner stopped: %v", err)
		}
	})

	t.Run("foreground signal releases PID record", func(t *testing.T) {
		home := t.TempDir()
		command := exec.Command(binary, "daemon", "start", "--foreground", "--home", home, "--listen", "127.0.0.1:0")
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if command.Process != nil {
				_ = command.Process.Kill()
			}
		})
		waitForRecord(t, home)
		if err := command.Process.Signal(syscall.SIGTERM); err != nil {
			t.Fatal(err)
		}
		if err := command.Wait(); err != nil {
			t.Fatalf("foreground daemon exit: %v", err)
		}
		if _, err := os.Stat(daemon.PIDPath(home)); !os.IsNotExist(err) {
			t.Fatalf("PID record still exists: %v", err)
		}
	})

	t.Run("stale record is reclaimed and invalid record is preserved", func(t *testing.T) {
		staleHome := t.TempDir()
		writeRecord(t, staleHome, os.Getpid(), "127.0.0.1:1")
		status := inspectWithCLI(t, binary, staleHome)
		if status.LocalDaemon != "stale_pid" {
			t.Fatalf("stale status = %q", status.LocalDaemon)
		}
		t.Cleanup(func() { runCLI(binary, "daemon", "stop", "--home", staleHome) })
		mustRunCLI(t, binary, "daemon", "start", "--home", staleHome, "--listen", "127.0.0.1:0")
		mustRunCLI(t, binary, "daemon", "stop", "--home", staleHome)

		invalidHome := t.TempDir()
		invalid := []byte("not-json\n")
		if err := os.WriteFile(daemon.PIDPath(invalidHome), invalid, 0o600); err != nil {
			t.Fatal(err)
		}
		result := runCLI(binary, "daemon", "start", "--home", invalidHome, "--listen", "127.0.0.1:0")
		if result.code == 0 {
			t.Fatal("start unexpectedly replaced invalid PID record")
		}
		got, err := os.ReadFile(daemon.PIDPath(invalidHome))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, invalid) {
			t.Fatalf("invalid PID record changed: %q", got)
		}
	})

	t.Run("occupied port leaves no PID record", func(t *testing.T) {
		home := t.TempDir()
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		result := runCLI(binary, "daemon", "start", "--home", home, "--listen", listener.Addr().String())
		if result.code == 0 || !bytes.Contains(result.stderr, []byte("address already in use")) {
			t.Fatalf("occupied start = code %d, stderr %q", result.code, result.stderr)
		}
		if _, err := os.Stat(daemon.PIDPath(home)); !os.IsNotExist(err) {
			t.Fatalf("PID record exists after bind failure: %v", err)
		}
	})

	t.Run("stale record reusing a live PID never kills that process", func(t *testing.T) {
		home := t.TempDir()
		decoy := exec.Command(os.Args[0], "-test.run=TestDecoyProcess")
		decoy.Env = append(os.Environ(), "BYSPACE_DECOY=1")
		if err := decoy.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_ = decoy.Process.Kill()
			_ = decoy.Wait()
		}()
		writeRecord(t, home, decoy.Process.Pid, "127.0.0.1:1")

		status := inspectWithCLI(t, binary, home)
		if status.LocalDaemon != "stale_pid" {
			t.Fatalf("decoy status = %q (%s)", status.LocalDaemon, status.Note)
		}
		stop := runCLI(binary, "daemon", "stop", "--home", home)
		if stop.code != 0 {
			t.Fatalf("decoy stop = code %d, stderr %q", stop.code, stop.stderr)
		}
		if _, err := os.Stat(daemon.PIDPath(home)); !os.IsNotExist(err) {
			t.Fatalf("stale decoy record still exists: %v", err)
		}
		if err := decoy.Process.Signal(syscall.Signal(0)); err != nil {
			t.Fatalf("decoy was killed: %v", err)
		}
	})
}

func TestDecoyProcess(t *testing.T) {
	if os.Getenv("BYSPACE_DECOY") != "1" {
		return
	}
	select {}
}

type cliResult struct {
	stdout []byte
	stderr []byte
	code   int
}

func buildBinary(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "byspace")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	command := exec.Command("go", "build", "-o", binary, ".")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build byspace: %v\n%s", err, output)
	}
	return binary
}

func runCLI(binary string, args ...string) cliResult {
	command := exec.Command(binary, args...)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	code := 0
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			code = exitError.ExitCode()
		} else {
			code = -1
		}
	}
	return cliResult{stdout: stdout.Bytes(), stderr: stderr.Bytes(), code: code}
}

func mustRunCLI(t *testing.T, binary string, args ...string) cliResult {
	t.Helper()
	result := runCLI(binary, args...)
	if result.code != 0 {
		t.Fatalf("byspace %v exited %d\nstdout: %s\nstderr: %s", args, result.code, result.stdout, result.stderr)
	}
	return result
}

func decodeJSON(t *testing.T, data []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("decode JSON %q: %v", data, err)
	}
}

func inspectWithCLI(t *testing.T, binary, home string) daemon.Status {
	t.Helper()
	result := mustRunCLI(t, binary, "daemon", "status", "--home", home, "--json")
	var status daemon.Status
	decodeJSON(t, result.stdout, &status)
	return status
}

func waitForRecord(t *testing.T, home string) daemon.PIDRecord {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		record, err := daemon.ReadPIDRecord(home)
		if err == nil {
			return record
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for PID record")
	return daemon.PIDRecord{}
}

func writeRecord(t *testing.T, home string, pid int, listen string) {
	t.Helper()
	serverID, err := daemon.GetOrCreateServerID(home)
	if err != nil {
		t.Fatal(err)
	}
	record := daemon.PIDRecord{
		PID:           pid,
		StartedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Hostname:      "test-host",
		Listen:        listen,
		ServerID:      serverID,
		InstanceID:    "inst_test",
		ShutdownToken: "secret",
	}
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(daemon.PIDPath(home), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertPrivateMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode = %o, want %o", path, got, want)
	}
}

func httpPost(url, token string) (int, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, nil)
	if err != nil {
		return 0, err
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}
