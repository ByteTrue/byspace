package providers

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// ACP reverse terminal, ported from acp-agent.ts createTerminal and friends.
//
// The client advertises `terminal: true` in its capabilities, which means the agent may ask the
// client to run a command instead of running it itself. Advertising it without implementing the
// methods leaves every such request unanswered: the agent waits for a terminal id that never
// arrives, and the turn stalls with nothing shown.

// acpTerminal is one spawned command the agent asked for.
type acpTerminal struct {
	id     string
	cmd    *exec.Cmd
	output bytes.Buffer
	mu     sync.Mutex
	// ByteLimit is the agent's cap on retained output; 0 means unlimited. The TAIL is kept —
	// a build's last lines are what matters, and the beginning is what a long log buries.
	byteLimit int
	truncated bool
	// done closes when the process exits; exitCode and signal are read after it closes.
	done     chan struct{}
	exitCode *int
	signal   *string
}

// appendOutput appends a chunk, honouring the byte limit.
func (t *acpTerminal) appendOutput(chunk string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.output.WriteString(chunk)
	if t.byteLimit <= 0 || t.output.Len() <= t.byteLimit {
		return
	}
	t.truncated = true
	current := t.output.Bytes()
	// Keep the tail.
	kept := current[len(current)-t.byteLimit:]
	trimmed := make([]byte, len(kept))
	copy(trimmed, kept)
	t.output.Reset()
	t.output.Write(trimmed)
}

// snapshot returns the retained output and whether it was truncated.
func (t *acpTerminal) snapshot() (string, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.output.String(), t.truncated
}

// handleACPReverseTerminal serves the terminal/* reverse requests.
//
// Returns true when the method belonged to this family.
func (s *ACPSession) handleACPReverseTerminal(rpcID any, method string, params map[string]any) bool {
	switch method {
	case "terminal/create":
		s.acpCreateTerminal(rpcID, params)
	case "terminal/output":
		s.acpTerminalOutput(rpcID, params)
	case "terminal/wait_for_exit":
		s.acpWaitForTerminalExit(rpcID, params)
	case "terminal/kill":
		s.acpKillTerminal(rpcID, params)
	case "terminal/release":
		s.acpReleaseTerminal(rpcID, params)
	default:
		return false
	}
	return true
}

func (s *ACPSession) acpCreateTerminal(rpcID any, params map[string]any) {
	command, _ := params["command"].(string)
	args := make([]string, 0, 4)
	if rawArgs, ok := params["args"].([]any); ok {
		for _, item := range rawArgs {
			if arg, isString := item.(string); isString {
				args = append(args, arg)
			}
		}
	}
	if strings.TrimSpace(command) == "" {
		s.sendACPTerminalError(rpcID, "terminal/create needs a command")
		return
	}

	cmd := exec.Command(command, args...)
	if cwd, ok := params["cwd"].(string); ok && strings.TrimSpace(cwd) != "" {
		cmd.Dir = cwd
	}
	env := make([]string, 0, 8)
	if rawEnv, ok := params["env"].([]any); ok {
		for _, item := range rawEnv {
			entry, isObject := item.(map[string]any)
			if !isObject {
				continue
			}
			name, _ := entry["name"].(string)
			value, _ := entry["value"].(string)
			if name != "" {
				env = append(env, name+"="+value)
			}
		}
	}
	if len(env) > 0 {
		cmd.Env = append(cmd.Environ(), env...)
	}
	// An empty variable list is not a request to inherit nothing; only an explicit list replaces.
	if cmd.Env == nil {
		cmd.Env = cmd.Environ()
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.sendACPTerminalError(rpcID, err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.sendACPTerminalError(rpcID, err.Error())
		return
	}
	// Its own group, so stopping the terminal stops what it spawned. A shell that forks leaves the
	// grandchild holding the stdout pipe, and the drain goroutines below never see EOF.
	ownProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		s.sendACPTerminalError(rpcID, err.Error())
		return
	}

	terminal := &acpTerminal{id: fmt.Sprintf("acp_term_%v", rpcID), cmd: cmd, done: make(chan struct{})}
	if limit, ok := numericParam(params, "outputByteLimit"); ok && limit > 0 {
		terminal.byteLimit = limit
	}

	var wg sync.WaitGroup
	wg.Add(2)
	drain := func(pipe interface{ Read([]byte) (int, error) }) {
		defer wg.Done()
		buf := make([]byte, 8192)
		for {
			n, readErr := pipe.Read(buf)
			if n > 0 {
				terminal.appendOutput(string(buf[:n]))
			}
			if readErr != nil {
				return
			}
		}
	}
	go drain(stdout)
	go drain(stderr)

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		if waitErr != nil {
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				code := exitErr.ExitCode()
				terminal.exitCode = &code
			}
		} else {
			code := 0
			terminal.exitCode = &code
		}
		close(terminal.done)
	}()

	s.acpTerminalsMu.Lock()
	if s.acpTerminals == nil {
		s.acpTerminals = make(map[string]*acpTerminal)
	}
	s.acpTerminals[terminal.id] = terminal
	s.acpTerminalsMu.Unlock()

	s.sendACPResult(rpcID, map[string]any{"terminalId": terminal.id})
}

func (s *ACPSession) acpTerminalOutput(rpcID any, params map[string]any) {
	terminal := s.acpTerminalByID(params)
	if terminal == nil {
		s.sendACPTerminalError(rpcID, "unknown terminal")
		return
	}
	output, truncated := terminal.snapshot()
	result := map[string]any{"output": output, "truncated": truncated}
	// exitStatus is present only once the process has exited; the field is optional and sending
	// null would fail the schema.
	select {
	case <-terminal.done:
		if terminal.exitCode != nil {
			result["exitStatus"] = map[string]any{"exitCode": *terminal.exitCode}
		}
	default:
	}
	s.sendACPResult(rpcID, result)
}

func (s *ACPSession) acpWaitForTerminalExit(rpcID any, params map[string]any) {
	terminal := s.acpTerminalByID(params)
	if terminal == nil {
		s.sendACPTerminalError(rpcID, "unknown terminal")
		return
	}
	<-terminal.done
	result := map[string]any{}
	if terminal.exitCode != nil {
		result["exitCode"] = *terminal.exitCode
	}
	if terminal.signal != nil {
		result["signal"] = *terminal.signal
	}
	s.sendACPResult(rpcID, result)
}

func (s *ACPSession) acpKillTerminal(rpcID any, params map[string]any) {
	terminal := s.acpTerminalByID(params)
	if terminal == nil {
		s.sendACPTerminalError(rpcID, "unknown terminal")
		return
	}
	_ = killProcessGroup(terminal.cmd, true)
	s.sendACPResult(rpcID, map[string]any{})
}

func (s *ACPSession) acpReleaseTerminal(rpcID any, params map[string]any) {
	terminal := s.acpTerminalByID(params)
	if terminal == nil {
		s.sendACPResult(rpcID, map[string]any{})
		return
	}
	// The agent is done with it; leaving the entry would keep the output buffer alive for the
	// whole session.
	_ = killProcessGroup(terminal.cmd, true)
	s.acpTerminalsMu.Lock()
	delete(s.acpTerminals, terminal.id)
	s.acpTerminalsMu.Unlock()
	s.sendACPResult(rpcID, map[string]any{})
}

func (s *ACPSession) acpTerminalByID(params map[string]any) *acpTerminal {
	id, _ := params["terminalId"].(string)
	if id == "" {
		return nil
	}
	s.acpTerminalsMu.Lock()
	defer s.acpTerminalsMu.Unlock()
	return s.acpTerminals[id]
}

func (s *ACPSession) sendACPTerminalError(rpcID any, message string) {
	_ = s.sendJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      rpcID,
		"error":   map[string]any{"code": -32000, "message": message},
	})
}

func (s *ACPSession) sendACPResult(rpcID any, result map[string]any) {
	_ = s.sendJSON(map[string]any{"jsonrpc": "2.0", "id": rpcID, "result": result})
}
