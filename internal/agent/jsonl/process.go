package jsonl

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/proc"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	V2FrameBytes       = 1024 * 1024
	V2ReassembledBytes = 64 * 1024 * 1024
	V2ChunkBytes       = 256 * 1024
	MaxStderrBytes     = 8192
)

// LaunchConfig describes how to spawn a JSONL RPC subprocess.
type LaunchConfig struct {
	Command string
	Args    []string
	Cwd     string
	Env     []string
}

type rpcResponse struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Command string          `json:"command"`
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error"`
}

type chunkHeader struct {
	Type       string `json:"type"`
	ChunkID    string `json:"chunkId"`
	Index      int    `json:"index"`
	Count      int    `json:"count"`
	ByteLength int    `json:"byteLength"`
	Data       string `json:"data"`
}

type chunkAssembly struct {
	id         string
	count      int
	byteLength int
	parts      [][]byte
	bytes      int
}

type pendingCall struct {
	ch chan rpcResponse
}

// Process manages a bidirectional newline-delimited JSON RPC subprocess (such as Pi or Codex).
type Process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser

	writeMu sync.Mutex
	mu      sync.Mutex
	pending map[string]*pendingCall
	subs    map[int]func(map[string]any)
	nextSub int
	reqSeq  atomic.Uint64

	stderrBuf bytes.Buffer
	assembly  *chunkAssembly
	closed    bool
	done      chan struct{}
	exitErr   error
}

// Start spawns the subprocess and begins decoding JSONL frames from its stdout.
func Start(cfg LaunchConfig) (*Process, error) {
	if strings.TrimSpace(cfg.Command) == "" {
		return nil, errors.New("empty command for JSONL RPC process")
	}
	cmd := proc.Command(cfg.Command, cfg.Args...)
	// Own process group: killing only the parent would orphan whatever the provider spawned.
	setupProcessGroup(cmd)
	if cfg.Cwd != "" {
		cmd.Dir = cfg.Cwd
	}
	// Every child gets the stripped environment, whether the caller supplied one or not: an
	// agent that inherits the supervisor's markers changes behaviour (the Pi activity extension
	// registers no handlers when it sees a foreign owner pid).
	if len(cfg.Env) > 0 {
		cmd.Env = home.ExternalProcessEnv(cfg.Env)
	} else {
		cmd.Env = home.ExternalProcessEnv(os.Environ())
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	p := &Process{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		pending: make(map[string]*pendingCall),
		subs:    make(map[int]func(map[string]any)),
		done:    make(chan struct{}),
	}

	go p.readStderr()
	go p.readStdout()
	return p, nil
}

func (p *Process) readStderr() {
	buf := make([]byte, 4096)
	for {
		n, err := p.stderr.Read(buf)
		if n > 0 {
			p.mu.Lock()
			p.stderrBuf.Write(buf[:n])
			if p.stderrBuf.Len() > MaxStderrBytes {
				b := p.stderrBuf.Bytes()
				p.stderrBuf.Reset()
				p.stderrBuf.Write(b[len(b)-MaxStderrBytes:])
			}
			p.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (p *Process) readStdout() {
	reader := bufio.NewReaderSize(p.stdout, 64*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			trimmed := bytes.TrimSpace(line)
			if len(trimmed) > 0 {
				trace.record("<<", trimmed)
				p.consumeLine(trimmed)
			}
		}
		if err != nil {
			break
		}
	}

	waitErr := p.cmd.Wait()
	p.mu.Lock()
	stderrText := strings.TrimSpace(p.stderrBuf.String())
	if waitErr != nil {
		if stderrText != "" {
			p.exitErr = fmt.Errorf("process exited (%v): %s", waitErr, stderrText)
		} else {
			p.exitErr = fmt.Errorf("process exited (%v)", waitErr)
		}
	} else {
		p.exitErr = errors.New("process exited")
	}
	exitErr := p.exitErr
	for id, call := range p.pending {
		delete(p.pending, id)
		call.ch <- rpcResponse{Success: false, Error: exitErr.Error()}
	}
	subs := make([]func(map[string]any), 0, len(p.subs))
	for _, fn := range p.subs {
		subs = append(subs, fn)
	}
	p.mu.Unlock()

	for _, fn := range subs {
		fn(map[string]any{
			"type":  "process_exit",
			"error": exitErr.Error(),
		})
	}
	close(p.done)
}

func (p *Process) consumeLine(line []byte) {
	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &probe); err != nil {
		return
	}
	if probe.Type == "rpc_chunk" {
		p.consumeChunk(line)
		return
	}
	p.dispatchRawJSON(line)
}

func (p *Process) consumeChunk(line []byte) {
	var hdr chunkHeader
	if err := json.Unmarshal(line, &hdr); err != nil {
		p.assembly = nil
		return
	}
	if hdr.ChunkID == "" || hdr.Count < 2 || hdr.Index < 0 || hdr.Index >= hdr.Count || hdr.ByteLength > V2ReassembledBytes {
		p.assembly = nil
		return
	}
	decoded, err := base64.StdEncoding.DecodeString(hdr.Data)
	if err != nil || len(decoded) > V2ChunkBytes {
		p.assembly = nil
		return
	}

	if hdr.Index == 0 {
		p.assembly = &chunkAssembly{
			id:         hdr.ChunkID,
			count:      hdr.Count,
			byteLength: hdr.ByteLength,
			parts:      [][]byte{decoded},
			bytes:      len(decoded),
		}
		return
	}
	if p.assembly == nil || p.assembly.id != hdr.ChunkID || len(p.assembly.parts) != hdr.Index {
		p.assembly = nil
		return
	}
	p.assembly.parts = append(p.assembly.parts, decoded)
	p.assembly.bytes += len(decoded)
	if len(p.assembly.parts) < p.assembly.count {
		return
	}
	if p.assembly.bytes != p.assembly.byteLength {
		p.assembly = nil
		return
	}
	full := bytes.Join(p.assembly.parts, nil)
	p.assembly = nil
	p.dispatchRawJSON(full)
}

func (p *Process) dispatchRawJSON(raw []byte) {
	var resp rpcResponse
	if err := json.Unmarshal(raw, &resp); err == nil && resp.Type == "response" && resp.ID != "" {
		p.mu.Lock()
		call, ok := p.pending[resp.ID]
		if ok {
			delete(p.pending, resp.ID)
		}
		p.mu.Unlock()
		if ok {
			call.ch <- resp
			return
		}
	}

	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return
	}

	p.mu.Lock()
	subs := make([]func(map[string]any), 0, len(p.subs))
	for _, fn := range p.subs {
		subs = append(subs, fn)
	}
	p.mu.Unlock()

	for _, fn := range subs {
		fn(generic)
	}
}

// OnEvent registers a listener for non-response JSONL events emitted by the subprocess.
func (p *Process) OnEvent(fn func(map[string]any)) func() {
	p.mu.Lock()
	id := p.nextSub
	p.nextSub++
	p.subs[id] = fn
	p.mu.Unlock()
	return func() {
		p.mu.Lock()
		delete(p.subs, id)
		p.mu.Unlock()
	}
}

// SendRaw writes a JSON object followed by a newline to the subprocess stdin without waiting for a response.
func (p *Process) SendRaw(payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	_, err = p.stdin.Write(b)
	trace.record(">>", b)
	return err
}

// Request sends a command with an auto-generated "id": "req_N" and waits for the matching "type": "response".
func (p *Process) Request(ctx context.Context, command map[string]any) (json.RawMessage, error) {
	reqID := fmt.Sprintf("req_%d", p.reqSeq.Add(1))
	outbound := make(map[string]any, len(command)+1)
	for k, v := range command {
		outbound[k] = v
	}
	outbound["id"] = reqID

	call := &pendingCall{ch: make(chan rpcResponse, 1)}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("JSONL RPC process is closed")
	}
	p.pending[reqID] = call
	p.mu.Unlock()

	if err := p.SendRaw(outbound); err != nil {
		p.mu.Lock()
		delete(p.pending, reqID)
		p.mu.Unlock()
		return nil, err
	}

	select {
	case resp := <-call.ch:
		if !resp.Success {
			errMsg := strings.TrimSpace(resp.Error)
			if errMsg == "" {
				errMsg = fmt.Sprintf("RPC command %q failed", command["type"])
			}
			return nil, errors.New(errMsg)
		}
		return resp.Data, nil
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.pending, reqID)
		p.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Close terminates the subprocess and waits for reader goroutines to finish.
func (p *Process) Close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	p.mu.Unlock()

	// Three-stage close, following tree-kill.ts.
	//
	// Closing stdin is the graceful signal for these CLIs: they finish the current write and
	// exit. If that does not happen the process gets SIGTERM, which still lets it flush; only
	// after that is it worth risking SIGKILL. A truncated provider session file is not
	// recoverable — the transcript is the user's history.
	_ = p.stdin.Close()
	select {
	case <-p.done:
		return nil
	case <-time.After(gracefulCloseTimeout):
	}

	terminateProcessTree(p.cmd)
	select {
	case <-p.done:
		return nil
	case <-time.After(forceCloseTimeout):
		killProcessTree(p.cmd)
		<-p.done
		return nil
	}
}

// Close timeouts: long enough for a provider to finish writing, short enough that a stuck
// process does not hold the daemon.
const (
	gracefulCloseTimeout = 2 * time.Second
	forceCloseTimeout    = 2 * time.Second
)
