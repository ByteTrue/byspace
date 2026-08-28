package daemon

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestParseRelayURLRequiresRootWebSocketOrigin(t *testing.T) {
	parsed, err := ParseRelayURL("wss://relay.byspace.cc.cd/")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.String() != "wss://relay.byspace.cc.cd" {
		t.Fatalf("Relay URL = %q", parsed.String())
	}
	for _, invalid := range []string{
		"https://relay.byspace.cc.cd",
		"relay.byspace.cc.cd",
		"wss://user@relay.byspace.cc.cd",
		"wss://relay.byspace.cc.cd/base",
		"wss://relay.byspace.cc.cd/?token=secret",
	} {
		if _, err := ParseRelayURL(invalid); err == nil {
			t.Fatalf("invalid Relay URL %q was accepted", invalid)
		}
	}
}

func TestRelaySocketURLUsesProductionV2Contract(t *testing.T) {
	endpoint, err := ParseRelayURL("wss://relay.byspace.cc.cd")
	if err != nil {
		t.Fatal(err)
	}
	runtime := relayRuntime{endpoint: endpoint, serverID: "srv_test"}
	control, err := url.Parse(runtime.relaySocketURL(""))
	if err != nil {
		t.Fatal(err)
	}
	if control.Path != "/ws" || control.Query().Get("role") != "server" || control.Query().Get("serverId") != "srv_test" || control.Query().Get("v") != "2" || control.Query().Has("connectionId") {
		t.Fatalf("unexpected control URL: %s", control)
	}
	data, err := url.Parse(runtime.relaySocketURL("conn_123"))
	if err != nil {
		t.Fatal(err)
	}
	if data.Query().Get("connectionId") != "conn_123" {
		t.Fatalf("unexpected data URL: %s", data)
	}
}

func TestRelaySyncFreesStaleCapacityBeforeStartingReplacement(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	endpoint, err := url.Parse("ws" + strings.TrimPrefix(server.URL, "http"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	runtime := &relayRuntime{
		endpoint: endpoint,
		serverID: "srv_test",
		ctx:      ctx,
		cancel:   cancel,
		active:   make(chan struct{}, relayMaxSessions),
		sessions: make(map[string]*relayDataSession),
		output:   io.Discard,
	}
	defer runtime.Close()

	for index := 0; index < relayMaxSessions; index++ {
		connectionID := fmt.Sprintf("conn_%02d", index)
		sessionCtx, sessionCancel := context.WithCancel(ctx)
		session := &relayDataSession{cancel: sessionCancel, done: make(chan struct{})}
		runtime.sessions[connectionID] = session
		runtime.active <- struct{}{}
		go func() {
			<-sessionCtx.Done()
			runtime.sessionsM.Lock()
			if runtime.sessions[connectionID] == session {
				delete(runtime.sessions, connectionID)
			}
			runtime.sessionsM.Unlock()
			<-runtime.active
			close(session.done)
		}()
	}

	wanted := make([]string, 0, relayMaxSessions)
	for index := 0; index < relayMaxSessions-1; index++ {
		wanted = append(wanted, fmt.Sprintf("conn_%02d", index))
	}
	wanted = append(wanted, "conn_replacement")
	message := fmt.Sprintf(`{"type":"sync","connectionIds":["%s"]}`, strings.Join(wanted, `","`))
	if err := runtime.handleControlMessage([]byte(message)); err != nil {
		t.Fatal(err)
	}

	runtime.sessionsM.Lock()
	_, replacementStarted := runtime.sessions["conn_replacement"]
	_, staleRemains := runtime.sessions["conn_31"]
	runtime.sessionsM.Unlock()
	if !replacementStarted || staleRemains || len(runtime.active) != relayMaxSessions {
		t.Fatalf("sync did not converge at capacity: replacement=%v stale=%v active=%d", replacementStarted, staleRemains, len(runtime.active))
	}
}

func TestRelayDataDialRetriesOnlyTransientFailures(t *testing.T) {
	for _, test := range []struct {
		name     string
		response *http.Response
		want     bool
	}{
		{name: "network", want: true},
		{name: "request timeout", response: &http.Response{StatusCode: http.StatusRequestTimeout}, want: true},
		{name: "too early", response: &http.Response{StatusCode: http.StatusTooEarly}, want: true},
		{name: "rate limited", response: &http.Response{StatusCode: http.StatusTooManyRequests}, want: true},
		{name: "server error", response: &http.Response{StatusCode: http.StatusServiceUnavailable}, want: true},
		{name: "bad request", response: &http.Response{StatusCode: http.StatusBadRequest}},
		{name: "unauthorized", response: &http.Response{StatusCode: http.StatusUnauthorized}},
		{name: "not found", response: &http.Response{StatusCode: http.StatusNotFound}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := retryRelayDataDial(test.response); got != test.want {
				t.Fatalf("retry = %v, want %v", got, test.want)
			}
		})
	}
}

func TestRelayDataSessionRetriesTransientDialFailure(t *testing.T) {
	var attempts atomic.Int32
	attached := make(chan error, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if attempts.Add(1) == 1 {
			http.Error(writer, "transient", http.StatusServiceUnavailable)
			return
		}
		socket, err := websocket.Accept(writer, request, nil)
		if err != nil {
			attached <- err
			return
		}
		defer socket.CloseNow()
		readCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		messageType, _, err := socket.Read(readCtx)
		if err == nil && messageType != websocket.MessageText {
			err = fmt.Errorf("challenge frame type = %v, want text", messageType)
		}
		attached <- err
		<-release
	}))
	defer server.Close()

	runtime := newRelayRuntimeTestHarness(t, server.URL)
	defer runtime.Close()
	runtime.startDataSession("conn_retry")
	select {
	case err := <-attached:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Relay data session did not attach after transient dial failure")
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("data dial attempts = %d, want 2", got)
	}
	done := runtime.stopDataSession("conn_retry")
	close(release)
	waitRelaySessionDone(t, done)
}

func TestRelayDataSessionCancellationStopsDialRetry(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		http.Error(writer, "transient", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	runtime := newRelayRuntimeTestHarness(t, server.URL)
	defer runtime.Close()
	backoffEntered := make(chan struct{}, 1)
	runtime.dataRetryWait = func(ctx context.Context, _ time.Duration) bool {
		backoffEntered <- struct{}{}
		<-ctx.Done()
		return false
	}
	runtime.startDataSession("conn_cancel")
	select {
	case <-backoffEntered:
	case <-time.After(time.Second):
		t.Fatal("Relay data session did not enter retry backoff")
	}
	done := runtime.stopDataSession("conn_cancel")
	waitRelaySessionDone(t, done)
	if got := attempts.Load(); got != 1 {
		t.Fatalf("data dial attempts after cancellation = %d, want 1", got)
	}
	if len(runtime.active) != 0 {
		t.Fatalf("active Relay sessions = %d, want 0", len(runtime.active))
	}
}

func TestRelayDisconnectedWaitsForGenerationTeardown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "transient", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	runtime := newRelayRuntimeTestHarness(t, server.URL)
	defer runtime.Close()
	backoffEntered := make(chan struct{}, 2)
	backoffExited := make(chan struct{}, 2)
	runtime.dataRetryWait = func(ctx context.Context, _ time.Duration) bool {
		backoffEntered <- struct{}{}
		<-ctx.Done()
		backoffExited <- struct{}{}
		return false
	}
	const connectionID = "conn_generation"
	if err := runtime.handleControlMessage([]byte(`{"type":"connected","connectionId":"` + connectionID + `"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-backoffEntered:
	case <-time.After(time.Second):
		t.Fatal("first Relay generation did not enter retry backoff")
	}
	runtime.sessionsM.Lock()
	first := runtime.sessions[connectionID]
	runtime.sessionsM.Unlock()
	if first == nil {
		t.Fatal("first Relay generation was not registered")
	}

	// Hold the generation at its cleanup barrier after cancellation. The map
	// entry must remain authoritative until its capacity and done signal are
	// released together.
	<-runtime.active
	disconnected := make(chan error, 1)
	go func() {
		disconnected <- runtime.handleControlMessage([]byte(`{"type":"disconnected","connectionId":"` + connectionID + `"}`))
	}()
	select {
	case <-backoffExited:
	case <-time.After(time.Second):
		t.Fatal("first Relay generation did not leave retry backoff")
	}
	select {
	case err := <-disconnected:
		t.Fatalf("disconnected returned before generation teardown: %v", err)
	default:
	}
	runtime.sessionsM.Lock()
	stillRegistered := runtime.sessions[connectionID] == first
	runtime.sessionsM.Unlock()
	if !stillRegistered {
		t.Fatal("first Relay generation disappeared before teardown completed")
	}

	runtime.active <- struct{}{}
	select {
	case err := <-disconnected:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("disconnected did not finish after generation teardown")
	}
	if err := runtime.handleControlMessage([]byte(`{"type":"connected","connectionId":"` + connectionID + `"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-backoffEntered:
	case <-time.After(time.Second):
		t.Fatal("replacement Relay generation did not start")
	}
	runtime.sessionsM.Lock()
	second := runtime.sessions[connectionID]
	runtime.sessionsM.Unlock()
	if second == nil || second == first {
		t.Fatal("replacement Relay generation was not registered after teardown")
	}
	if err := runtime.handleControlMessage([]byte(`{"type":"disconnected","connectionId":"` + connectionID + `"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestRelayRuntimeCloseStopsDialRetryAndWaits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "transient", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	runtime := newRelayRuntimeTestHarness(t, server.URL)
	backoffEntered := make(chan struct{}, 1)
	runtime.dataRetryWait = func(ctx context.Context, _ time.Duration) bool {
		backoffEntered <- struct{}{}
		<-ctx.Done()
		return false
	}
	runtime.startDataSession("conn_shutdown")
	select {
	case <-backoffEntered:
	case <-time.After(time.Second):
		t.Fatal("Relay data session did not enter retry backoff")
	}
	closed := make(chan struct{})
	go func() {
		runtime.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Relay runtime Close did not stop data retry")
	}
	runtime.sessionsM.Lock()
	sessionCount := len(runtime.sessions)
	runtime.sessionsM.Unlock()
	if sessionCount != 0 || len(runtime.active) != 0 {
		t.Fatalf("Relay runtime Close left sessions=%d active=%d", sessionCount, len(runtime.active))
	}
}

func TestRelayDuplicateConnectedUsesSingleSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "transient", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	runtime := newRelayRuntimeTestHarness(t, server.URL)
	defer runtime.Close()
	runtime.startDataSession("conn_duplicate")
	runtime.startDataSession("conn_duplicate")
	runtime.sessionsM.Lock()
	sessionCount := len(runtime.sessions)
	runtime.sessionsM.Unlock()
	if sessionCount != 1 || len(runtime.active) != 1 {
		t.Fatalf("duplicate connected created sessions=%d active=%d, want 1/1", sessionCount, len(runtime.active))
	}
	waitRelaySessionDone(t, runtime.stopDataSession("conn_duplicate"))
}

func newRelayRuntimeTestHarness(t *testing.T, serverURL string) *relayRuntime {
	t.Helper()
	endpoint, err := url.Parse("ws" + strings.TrimPrefix(serverURL, "http"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &relayRuntime{
		endpoint: endpoint,
		serverID: "srv_test",
		ctx:      ctx,
		cancel:   cancel,
		active:   make(chan struct{}, relayMaxSessions),
		sessions: make(map[string]*relayDataSession),
		output:   io.Discard,
	}
}

func waitRelaySessionDone(t *testing.T, done <-chan struct{}) {
	t.Helper()
	if done == nil {
		t.Fatal("Relay data session was not registered")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Relay data session did not stop")
	}
}

func TestRelayControlMessagesRejectUnknownAndTrailingData(t *testing.T) {
	for _, data := range [][]byte{
		[]byte(`{"type":"unknown"}`),
		[]byte(`{"type":"connected","connectionId":""}`),
		[]byte(`{"type":"connected","connectionId":" leading"}`),
		[]byte(`{"type":"connected","connectionId":"line\\nbreak"}`),
		[]byte(`{"type":"connected","connectionId":"snowman_☃"}`),
		[]byte(`{"type":"sync","connectionIds":[]} {}`),
	} {
		runtime := relayRuntime{}
		if err := runtime.handleControlMessage(data); err == nil {
			t.Fatalf("invalid control message accepted: %s", data)
		}
	}
}
