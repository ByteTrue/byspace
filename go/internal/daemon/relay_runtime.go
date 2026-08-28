package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"byspace/internal/relay"
	"github.com/coder/websocket"
)

const (
	relayControlReadLimit = 64 << 10
	relayMaxSessions      = 32
	relayConnectionIDMax  = 128
	relayRetryMax         = 30 * time.Second
	relayDataRetryMin     = 100 * time.Millisecond
	relayDataRetryMax     = 5 * time.Second
	relayHealthyInterval  = 30 * time.Second
)

type relayControlEnvelope struct {
	Type string `json:"type"`
}

type relayConnectionMessage struct {
	Type         string `json:"type"`
	ConnectionID string `json:"connectionId"`
}

type relaySyncMessage struct {
	Type          string   `json:"type"`
	ConnectionIDs []string `json:"connectionIds"`
}

type relayDataSession struct {
	cancel context.CancelFunc
	done   chan struct{}
	socket *websocket.Conn
}

type relayRuntime struct {
	endpoint *url.URL
	serverID string
	identity relay.Identity
	handler  *agentWebSocketHandler
	output   io.Writer

	ctx           context.Context
	cancel        context.CancelFunc
	active        chan struct{}
	wait          sync.WaitGroup
	closeOne      sync.Once
	ready         atomic.Bool
	sessionsM     sync.Mutex
	sessions      map[string]*relayDataSession
	dataRetryWait func(context.Context, time.Duration) bool
}

func startRelayRuntime(parent context.Context, endpoint string, serverID string, identity relay.Identity, handler *agentWebSocketHandler, output io.Writer) (*relayRuntime, error) {
	parsed, err := ParseRelayURL(endpoint)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	runtime := &relayRuntime{
		endpoint: parsed,
		serverID: serverID,
		identity: identity,
		handler:  handler,
		output:   output,
		ctx:      ctx,
		cancel:   cancel,
		active:   make(chan struct{}, relayMaxSessions),
		sessions: make(map[string]*relayDataSession),
	}
	runtime.wait.Add(1)
	go runtime.run()
	return runtime, nil
}

// ParseRelayURL validates a root Relay WebSocket origin.
func ParseRelayURL(endpoint string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		return nil, fmt.Errorf("Relay URL must be an absolute ws:// or wss:// URL: %q", endpoint)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, fmt.Errorf("Relay URL must not contain userinfo, a path, query, or fragment: %q", endpoint)
	}
	parsed.Path = ""
	return parsed, nil
}

func (runtime *relayRuntime) run() {
	defer runtime.wait.Done()
	backoff := time.Second
	for runtime.ctx.Err() == nil {
		connectedFor, err := runtime.runControl()
		if runtime.ctx.Err() != nil {
			return
		}
		if connectedFor >= relayHealthyInterval {
			backoff = time.Second
		}
		delay := time.Duration(rand.Int64N(int64(backoff) + 1))
		runtime.logf("Relay control disconnected: %v; retrying in %s\n", err, delay)
		timer := time.NewTimer(delay)
		select {
		case <-runtime.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < relayRetryMax {
			backoff *= 2
			if backoff > relayRetryMax {
				backoff = relayRetryMax
			}
		}
	}
}

func (runtime *relayRuntime) runControl() (time.Duration, error) {
	controlURL := runtime.relaySocketURL("")
	connection, _, err := websocket.Dial(runtime.ctx, controlURL, nil)
	if err != nil {
		return 0, err
	}
	connectedAt := time.Now()
	runtime.ready.Store(true)
	defer runtime.ready.Store(false)
	defer connection.CloseNow()
	connection.SetReadLimit(relayControlReadLimit)
	runtime.logf("byspace daemon connected to Relay %s\n", runtime.endpoint.Redacted())

	for {
		messageType, data, err := connection.Read(runtime.ctx)
		if err != nil {
			return time.Since(connectedAt), err
		}
		if messageType != websocket.MessageText {
			return time.Since(connectedAt), fmt.Errorf("Relay control sent a non-text frame")
		}
		if err := runtime.handleControlMessage(data); err != nil {
			return time.Since(connectedAt), err
		}
	}
}

func (runtime *relayRuntime) handleControlMessage(data []byte) error {
	var envelope relayControlEnvelope
	if err := decodeSingleJSON(data, &envelope); err != nil {
		return fmt.Errorf("decode Relay control message: %w", err)
	}
	switch envelope.Type {
	case "connected", "disconnected":
		var message relayConnectionMessage
		if err := decodeSingleJSON(data, &message); err != nil {
			return fmt.Errorf("decode Relay %s message: %w", envelope.Type, err)
		}
		if err := validateRelayConnectionID(message.ConnectionID); err != nil {
			return err
		}
		if message.Type == "connected" {
			runtime.startDataSession(message.ConnectionID)
			return nil
		}
		return runtime.waitDataSession(runtime.stopDataSession(message.ConnectionID))
	case "sync":
		var message relaySyncMessage
		if err := decodeSingleJSON(data, &message); err != nil {
			return fmt.Errorf("decode Relay sync message: %w", err)
		}
		if len(message.ConnectionIDs) > relayConnectionIDMax {
			return fmt.Errorf("Relay sync contains too many connection IDs")
		}
		wanted := make(map[string]struct{}, len(message.ConnectionIDs))
		for _, connectionID := range message.ConnectionIDs {
			if err := validateRelayConnectionID(connectionID); err != nil {
				return err
			}
			wanted[connectionID] = struct{}{}
		}
		runtime.sessionsM.Lock()
		stale := make([]string, 0)
		for connectionID := range runtime.sessions {
			if _, ok := wanted[connectionID]; !ok {
				stale = append(stale, connectionID)
			}
		}
		runtime.sessionsM.Unlock()
		for _, connectionID := range stale {
			if err := runtime.waitDataSession(runtime.stopDataSession(connectionID)); err != nil {
				return err
			}
		}
		for connectionID := range wanted {
			runtime.startDataSession(connectionID)
		}
		return nil
	default:
		return fmt.Errorf("unknown Relay control message type %q", envelope.Type)
	}
}

func decodeSingleJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.More() {
		return fmt.Errorf("trailing JSON content")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("trailing JSON value")
		}
		return fmt.Errorf("trailing JSON content: %w", err)
	}
	return nil
}

func validateRelayConnectionID(connectionID string) error {
	if connectionID == "" || len(connectionID) > relayConnectionIDMax {
		return fmt.Errorf("Relay sent an invalid connection ID")
	}
	for i := 0; i < len(connectionID); i++ {
		c := connectionID[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			return fmt.Errorf("Relay sent an invalid connection ID")
		}
	}
	return nil
}

func (runtime *relayRuntime) startDataSession(connectionID string) {
	runtime.sessionsM.Lock()
	if runtime.ctx.Err() != nil {
		runtime.sessionsM.Unlock()
		return
	}
	if _, exists := runtime.sessions[connectionID]; exists {
		runtime.sessionsM.Unlock()
		return
	}
	select {
	case runtime.active <- struct{}{}:
	case <-runtime.ctx.Done():
		runtime.sessionsM.Unlock()
		return
	default:
		runtime.sessionsM.Unlock()
		runtime.logf("Relay connection %s rejected: session limit reached\n", connectionID)
		return
	}
	sessionCtx, cancel := context.WithCancel(runtime.ctx)
	session := &relayDataSession{cancel: cancel, done: make(chan struct{})}
	runtime.sessions[connectionID] = session
	runtime.wait.Add(1)
	runtime.sessionsM.Unlock()
	go runtime.serveDataConnection(sessionCtx, connectionID, session)
}

func (runtime *relayRuntime) stopDataSession(connectionID string) <-chan struct{} {
	runtime.sessionsM.Lock()
	session := runtime.sessions[connectionID]
	if session != nil {
		session.cancel()
		if session.socket != nil {
			_ = session.socket.CloseNow()
		}
	}
	runtime.sessionsM.Unlock()
	if session == nil {
		return nil
	}
	return session.done
}

func (runtime *relayRuntime) waitDataSession(done <-chan struct{}) error {
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-runtime.ctx.Done():
		return runtime.ctx.Err()
	}
}

func (runtime *relayRuntime) serveDataConnection(ctx context.Context, connectionID string, session *relayDataSession) {
	defer runtime.wait.Done()
	defer runtime.finishDataSession(connectionID, session)

	var socket *websocket.Conn
	backoff := relayDataRetryMin
	for {
		dialCtx, dialCancel := context.WithTimeout(ctx, 10*time.Second)
		var response *http.Response
		var err error
		socket, response, err = websocket.Dial(dialCtx, runtime.relaySocketURL(connectionID), nil)
		dialCancel()
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			return
		}
		if !retryRelayDataDial(response) {
			runtime.logf("Relay connection %s dial failed permanently: %v\n", connectionID, err)
			return
		}
		delay := time.Duration(rand.Int64N(int64(backoff) + 1))
		runtime.logf("Relay connection %s dial failed: %v; retrying in %s\n", connectionID, err, delay)
		if !runtime.waitForDataRetry(ctx, delay) {
			return
		}
		if backoff < relayDataRetryMax {
			backoff *= 2
			if backoff > relayDataRetryMax {
				backoff = relayDataRetryMax
			}
		}
	}
	runtime.sessionsM.Lock()
	if runtime.sessions[connectionID] != session || ctx.Err() != nil {
		runtime.sessionsM.Unlock()
		_ = socket.CloseNow()
		return
	}
	session.socket = socket
	runtime.sessionsM.Unlock()
	defer socket.CloseNow()

	handshakeCtx, handshakeCancel := context.WithTimeout(ctx, webSocketHelloTimeout)
	encrypted, err := acceptRelayEncryptedSocket(handshakeCtx, socket, runtime.identity)
	handshakeCancel()
	if err != nil {
		_ = socket.Close(websocket.StatusPolicyViolation, "Relay E2EE authentication failed")
		if ctx.Err() == nil {
			runtime.logf("Relay connection %s authentication failed: %v\n", connectionID, err)
		}
		return
	}
	runtime.handler.serveRemoteConnection(encrypted)
}

func (runtime *relayRuntime) finishDataSession(connectionID string, session *relayDataSession) {
	<-runtime.active
	runtime.sessionsM.Lock()
	if runtime.sessions[connectionID] == session {
		delete(runtime.sessions, connectionID)
	}
	close(session.done)
	runtime.sessionsM.Unlock()
}

func (runtime *relayRuntime) waitForDataRetry(ctx context.Context, delay time.Duration) bool {
	if runtime.dataRetryWait != nil {
		return runtime.dataRetryWait(ctx, delay)
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func retryRelayDataDial(response *http.Response) bool {
	if response == nil {
		return true
	}
	return response.StatusCode == http.StatusRequestTimeout ||
		response.StatusCode == http.StatusTooEarly ||
		response.StatusCode == http.StatusTooManyRequests ||
		response.StatusCode >= http.StatusInternalServerError
}

func (runtime *relayRuntime) relaySocketURL(connectionID string) string {
	resolved := *runtime.endpoint
	resolved.Path = "/ws"
	query := resolved.Query()
	query.Set("serverId", runtime.serverID)
	query.Set("role", "server")
	query.Set("v", "2")
	if connectionID != "" {
		query.Set("connectionId", connectionID)
	}
	resolved.RawQuery = query.Encode()
	return resolved.String()
}

func sameRelayOrigin(left, right *url.URL) bool {
	return left.Scheme == right.Scheme &&
		strings.EqualFold(left.Hostname(), right.Hostname()) &&
		effectiveRelayPort(left) == effectiveRelayPort(right)
}

func effectiveRelayPort(value *url.URL) string {
	if port := value.Port(); port != "" {
		return port
	}
	if value.Scheme == "wss" {
		return "443"
	}
	return "80"
}

func (runtime *relayRuntime) Ready() bool {
	return runtime != nil && runtime.ready.Load()
}

func (runtime *relayRuntime) Close() {
	runtime.closeOne.Do(func() {
		runtime.cancel()
		runtime.sessionsM.Lock()
		for _, session := range runtime.sessions {
			session.cancel()
			if session.socket != nil {
				_ = session.socket.CloseNow()
			}
		}
		runtime.sessionsM.Unlock()
		runtime.wait.Wait()
	})
}

func (runtime *relayRuntime) logf(format string, values ...any) {
	if runtime.output != nil {
		_, _ = fmt.Fprintf(runtime.output, format, values...)
	}
}
