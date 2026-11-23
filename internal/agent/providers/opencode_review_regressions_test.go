package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
)

type openCodeRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn openCodeRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestOpenCodeRedirectDoesNotForwardBasicAuth(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
		if r.Header.Get("Authorization") != "" {
			t.Error("Basic authorization crossed the redirect origin")
		}
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer source.Close()
	resp, err := newOpenCodeHTTPClient("secret").Get(source.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusFound || targetHits.Load() != 0 {
		t.Fatalf("status=%d targetHits=%d", resp.StatusCode, targetHits.Load())
	}
}

func TestOpenCodeStreamClientHasNoTotalTimeout(t *testing.T) {
	if timeout := newOpenCodeStreamHTTPClient("").Timeout; timeout != 0 {
		t.Fatalf("stream timeout = %s", timeout)
	}
}

func TestOpenCodeV2CommandsAndMCPUseCurrentAPI(t *testing.T) {
	var mcpMethod string
	var mcpBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/command":
			_, _ = w.Write([]byte(`{"data":[{"name":"review","description":"Review","hints":["[path]"],"source":"skill"}]}`))
		case "/api/experimental/mcp/demo":
			mcpMethod = r.Method
			_ = json.NewDecoder(r.Body).Decode(&mcpBody)
			_, _ = w.Write([]byte(`{}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient, s.version = server.URL, server.Client(), 2
	commands := s.listCommandsFromServer(context.Background())
	if len(commands) != 1 || commands[0].Name != "review" || commands[0].ArgumentHint != "[path]" || commands[0].Source != "skill" {
		t.Fatalf("commands = %#v", commands)
	}
	s.mcpServers = map[string]sdk.MCPServerConfig{"demo": {Type: "stdio", Command: "demo"}}
	if err := s.configureV2(context.Background()); err != nil {
		t.Fatal(err)
	}
	if mcpMethod != http.MethodPut || mcpBody["location"] != nil || mcpBody["config"] == nil {
		t.Fatalf("method=%q body=%v", mcpMethod, mcpBody)
	}
}

func TestOpenCodeFinalTextReplacesDivergentDelta(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.delta", map[string]any{"sessionID": "session-1", "messageID": "msg-1", "partID": "text-1", "field": "text", "delta": "world"}))
	s.handleOpenCodeEvent(openCodeTestEvent("message.part.updated", map[string]any{"part": map[string]any{"id": "text-1", "sessionID": "session-1", "messageID": "msg-1", "type": "text", "text": "hello world", "time": map[string]any{"end": 2}}}))
	timeline := s.Timeline()
	if len(timeline) != 1 || timeline[0].Item.Text != "hello world" {
		t.Fatalf("timeline = %#v", timeline)
	}
}

func TestOpenCodeV1AccumulatesStepCost(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.version = 1
	for _, cost := range []float64{0.1, 0.2} {
		s.applyOpenCodeStepUsageLocked(map[string]any{"cost": cost, "tokens": map[string]any{"input": 1, "output": 1}})
	}
	if math.Abs(s.lastUsage.TotalCostUSD-0.3) > 1e-9 {
		t.Fatalf("cost = %v", s.lastUsage.TotalCostUSD)
	}
}

func TestOpenCodeV1CostDoesNotAccumulateAcrossTurns(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.version = 1
	s.resetOpenCodeTurnUsageLocked()
	s.applyOpenCodeStepUsageLocked(map[string]any{"cost": 0.3, "tokens": map[string]any{"input": 1, "output": 1}})
	s.resetOpenCodeTurnUsageLocked()
	s.applyOpenCodeStepUsageLocked(map[string]any{"cost": 0.2, "tokens": map[string]any{"input": 1, "output": 1}})
	if math.Abs(s.lastUsage.TotalCostUSD-0.2) > 1e-9 {
		t.Fatalf("second-turn cost = %v", s.lastUsage.TotalCostUSD)
	}
}

func TestOpenCodeNumericArchiveAndV2Schema(t *testing.T) {
	if !openCodeSessionArchived(map[string]any{"archived": float64(123)}) || openCodeSessionArchived(map[string]any{"archived": float64(0)}) {
		t.Fatal("numeric archive timestamp was not interpreted correctly")
	}
	s := newOpenCodeEventFixture()
	s.version = 2
	if err := s.SetNextOutputSchema(map[string]any{"type": "object"}); err == nil {
		t.Fatal("v2 silently accepted an output schema it cannot enforce")
	}
}

func TestOpenCodeLateTurnCompletionCannotSettleNewTurn(t *testing.T) {
	s := newOpenCodeEventFixture()
	s.activeTurnID = "turn-2"
	s.finishOpenCodeTurnForID("turn-1", errors.New("late failure"), false)
	if s.Status() != "running" || s.activeTurnID != "turn-2" || s.lastError != "" {
		t.Fatalf("status=%q turn=%q error=%q", s.Status(), s.activeTurnID, s.lastError)
	}
}

func TestOpenCodeCloseCancelsDispatchAndReleasesWaiter(t *testing.T) {
	started := make(chan struct{})
	canceled := make(chan struct{})
	client := &http.Client{Transport: openCodeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		close(canceled)
		return nil, request.Context().Err()
	})}
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = "http://opencode.test", client
	s.status, s.activeTurnID = "idle", ""
	if err := s.Prompt(context.Background(), "hello", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("prompt was not dispatched")
	}
	waited := make(chan error, 1)
	go func() { waited <- s.WaitForFinish(context.Background()) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.mu.Lock()
		registered := len(s.finishWaiters) == 1
		s.mu.Unlock()
		if registered {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waiter was not registered")
		}
		time.Sleep(time.Millisecond)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-waited:
		if err == nil || !strings.Contains(err.Error(), "closed") {
			t.Fatalf("wait error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close left a prompt waiter blocked")
	}
	select {
	case <-canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not cancel the in-flight dispatch")
	}
}

func TestOpenCodeCanceledDispatchSettlesItsOwnTurn(t *testing.T) {
	started := make(chan struct{})
	client := &http.Client{Transport: openCodeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	s := newOpenCodeEventFixture()
	s.status, s.activeTurnID = "idle", ""
	s.baseURL, s.httpClient = "http://opencode.test", client
	if err := s.Prompt(context.Background(), "hello", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("prompt was not dispatched")
	}
	s.mu.Lock()
	s.dispatchCancel()
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.WaitForFinish(ctx); err == nil {
		t.Fatal("canceled dispatch left the turn running")
	}
}

func TestOpenCodeAbortCannotCancelANewerTurn(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	client := &http.Client{Transport: openCodeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
	})}
	s := newOpenCodeEventFixture()
	s.baseURL, s.httpClient = "http://opencode.test", client
	s.status, s.activeTurnID = "running", "turn-1"
	aborted := make(chan error, 1)
	go func() { aborted <- s.Abort(context.Background()) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("abort was not dispatched")
	}
	s.finishOpenCodeTurnForID("turn-1", nil, false)
	s.mu.Lock()
	s.status, s.activeTurnID = "running", "turn-2"
	s.mu.Unlock()
	close(release)
	if err := <-aborted; err != nil {
		t.Fatal(err)
	}
	if s.Status() != "running" || s.activeTurnID != "turn-2" {
		t.Fatalf("late abort settled %q (%s)", s.activeTurnID, s.Status())
	}
}

func TestOpenCodeACPFallbackCannotPanicNativeArchive(t *testing.T) {
	if err := archiveOpenCodeNativeSession(context.Background(), &ACPSession{}, true); err == nil {
		t.Fatal("ACP fallback was reported as native OpenCode archive support")
	}
}
