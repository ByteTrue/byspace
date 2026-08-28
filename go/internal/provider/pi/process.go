package pi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	maxStderrBytes = 64 << 10
	closeGrace     = time.Second
)

type rpcResult struct {
	message json.RawMessage
	err     error
}

type rpcProcess struct {
	command *exec.Cmd
	tree    *processTree
	stdin   io.WriteCloser
	events  chan json.RawMessage
	done    chan struct{}

	mu         sync.Mutex
	pending    map[string]chan rpcResult
	nextID     uint64
	closed     bool
	exitErr    error
	writeMu    sync.Mutex
	stderr     tailBuffer
	stderrDone chan struct{}
	closeOnce  sync.Once
}

func startRPCProcess(command *exec.Cmd) (*rpcProcess, error) {
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open Pi stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open Pi stdout: %w", err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("open Pi stderr: %w", err)
	}
	configureProcess(command)
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start Pi RPC process: %w", err)
	}
	tree, err := attachProcessTree(command)
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, fmt.Errorf("attach Pi process tree: %w", err)
	}

	process := &rpcProcess{
		command:    command,
		tree:       tree,
		stdin:      stdin,
		events:     make(chan json.RawMessage, 256),
		done:       make(chan struct{}),
		pending:    make(map[string]chan rpcResult),
		stderr:     tailBuffer{limit: maxStderrBytes},
		stderrDone: make(chan struct{}),
	}
	go func() {
		defer close(process.stderrDone)
		defer stderr.Close()
		_, _ = io.Copy(&process.stderr, stderr)
	}()
	go process.run(stdout)
	return process, nil
}

func (process *rpcProcess) PID() int {
	return process.command.Process.Pid
}

func (process *rpcProcess) Events() <-chan json.RawMessage {
	return process.events
}

func (process *rpcProcess) Request(ctx context.Context, command map[string]any) (json.RawMessage, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	process.mu.Lock()
	if process.closed {
		err := process.exitErr
		process.mu.Unlock()
		if err == nil {
			err = errors.New("Pi RPC process is closed")
		}
		return nil, false, err
	}
	process.nextID++
	id := fmt.Sprintf("req_%d", process.nextID)
	result := make(chan rpcResult, 1)
	process.pending[id] = result
	process.mu.Unlock()

	message := make(map[string]any, len(command)+1)
	for key, value := range command {
		message[key] = value
	}
	message["id"] = id
	data, err := json.Marshal(message)
	if err != nil {
		process.removePending(id, result)
		return nil, false, fmt.Errorf("encode Pi RPC command: %w", err)
	}
	data = append(data, '\n')

	process.writeMu.Lock()
	written, writeErr := process.stdin.Write(data)
	process.writeMu.Unlock()
	if writeErr == nil && written != len(data) {
		writeErr = io.ErrShortWrite
	}
	if writeErr != nil {
		process.removePending(id, result)
		return nil, true, fmt.Errorf("write Pi RPC command: %w", writeErr)
	}

	select {
	case <-ctx.Done():
		process.removePending(id, result)
		return nil, true, ctx.Err()
	case response := <-result:
		return response.message, true, response.err
	}
}

func (process *rpcProcess) Close(ctx context.Context) error {
	process.closeOnce.Do(func() { _ = process.stdin.Close() })
	grace := time.NewTimer(closeGrace)
	defer grace.Stop()
	select {
	case <-process.done:
		return nil
	case <-ctx.Done():
		_ = process.tree.terminate(process.command, true)
		return process.waitAfterKill(ctx.Err())
	case <-grace.C:
	}

	_ = process.tree.terminate(process.command, false)
	grace.Reset(closeGrace)
	select {
	case <-process.done:
		return nil
	case <-ctx.Done():
		_ = process.tree.terminate(process.command, true)
		return process.waitAfterKill(ctx.Err())
	case <-grace.C:
		_ = process.tree.terminate(process.command, true)
		return process.waitAfterKill(nil)
	}
}

func (process *rpcProcess) waitAfterKill(cause error) error {
	timer := time.NewTimer(closeGrace)
	defer timer.Stop()
	select {
	case <-process.done:
		return cause
	case <-timer.C:
		return errors.Join(cause, errors.New("Pi RPC process was not reaped after forced termination"))
	}
}

func (process *rpcProcess) Err() error {
	<-process.done
	process.mu.Lock()
	defer process.mu.Unlock()
	return process.exitErr
}

func (process *rpcProcess) run(stdout io.ReadCloser) {
	lines := make(chan []byte, 16)
	go func() {
		defer close(lines)
		defer stdout.Close()
		reader := bufio.NewReader(stdout)
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return
			}
			lines <- line[:len(line)-1]
		}
	}()

	waitResults := make(chan error, 1)
	go func() { waitResults <- waitDirectProcess(process.command) }()
	var waitChannel <-chan error = waitResults
	var waitErr error
	for {
		select {
		case line, ok := <-lines:
			if ok {
				process.handleLine(line)
				continue
			}
			if waitChannel != nil {
				waitErr = <-waitChannel
			}
			process.closeOnce.Do(func() { _ = process.stdin.Close() })
			_ = process.tree.terminate(process.command, true)
			<-process.stderrDone
			_ = process.tree.close()
			process.finish(waitErr)
			return
		case waitErr = <-waitChannel:
			waitChannel = nil
			process.closeOnce.Do(func() { _ = process.stdin.Close() })
			// The direct Pi process has exited. Kill any descendants before waiting
			// for inherited stdout/stderr handles to reach EOF.
			_ = process.tree.terminate(process.command, true)
		}
	}
}

func waitDirectProcess(command *exec.Cmd) error {
	state, err := command.Process.Wait()
	if err != nil {
		return err
	}
	if !state.Success() {
		return &exec.ExitError{ProcessState: state}
	}
	return nil
}

func (process *rpcProcess) handleLine(line []byte) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(line, &object); err != nil || object == nil {
		return
	}
	var messageType string
	if err := json.Unmarshal(object["type"], &messageType); err != nil || messageType == "" {
		return
	}
	copy := append(json.RawMessage(nil), line...)
	if messageType == "response" {
		var id string
		if err := json.Unmarshal(object["id"], &id); err != nil || id == "" {
			return
		}
		process.mu.Lock()
		pending := process.pending[id]
		if pending != nil {
			delete(process.pending, id)
		}
		process.mu.Unlock()
		if pending != nil {
			pending <- rpcResult{message: copy}
		}
		return
	}
	process.events <- copy
}

func (process *rpcProcess) finish(waitErr error) {
	stderr := strings.TrimSpace(process.stderr.String())
	if waitErr == nil {
		waitErr = errors.New("Pi RPC process exited")
	}
	if stderr != "" {
		waitErr = fmt.Errorf("%w; stderr: %s", waitErr, stderr)
	}

	process.mu.Lock()
	process.closed = true
	process.exitErr = waitErr
	pending := make([]chan rpcResult, 0, len(process.pending))
	for _, request := range process.pending {
		pending = append(pending, request)
	}
	clear(process.pending)
	process.mu.Unlock()

	for _, request := range pending {
		request <- rpcResult{err: waitErr}
	}
	close(process.events)
	close(process.done)
}

func (process *rpcProcess) removePending(id string, expected chan rpcResult) {
	process.mu.Lock()
	if process.pending[id] == expected {
		delete(process.pending, id)
	}
	process.mu.Unlock()
}

type tailBuffer struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (buffer *tailBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	originalLength := len(data)
	if len(data) >= buffer.limit {
		buffer.data = append(buffer.data[:0], data[len(data)-buffer.limit:]...)
		return originalLength, nil
	}
	if excess := len(buffer.data) + len(data) - buffer.limit; excess > 0 {
		copy(buffer.data, buffer.data[excess:])
		buffer.data = buffer.data[:len(buffer.data)-excess]
	}
	buffer.data = append(buffer.data, data...)
	return originalLength, nil
}

func (buffer *tailBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return string(append([]byte(nil), buffer.data...))
}
