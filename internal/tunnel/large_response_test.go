package tunnel

import (
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

// TestLargeResponseFlowsOnAFreshStream pushes a response bigger than the target's replay budget
// through a stream that has never reconnected.
//
// The target sequences every frame it sends, so it holds each payload until the manager
// acknowledges it. If those acknowledgements never arrive, the replay buffer fills at 16 MiB and
// the stream dies mid-response even though both peers are healthy and reading.
func TestLargeResponseFlowsOnAFreshStream(t *testing.T) {
	requireTCP(t)
	const total = 20 << 20 // 20 MiB, past the 16 MiB replay budget.
	payload := make([]byte, total)
	for i := range payload {
		payload[i] = byte(i)
	}

	service, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer service.Close()
	go func() {
		conn, err := service.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = conn.Write(payload)
	}()
	port := service.Addr().(*net.TCPAddr).Port

	manager, _, _ := wireManagerToTarget(t, []Endpoint{{Port: port}})
	if _, err := manager.AddForward(ForwardConfig{RemotePort: port, Label: "big"}); err != nil {
		t.Fatalf("add forward: %v", err)
	}
	localPort, ok := manager.LocalPort(port)
	if !ok {
		t.Fatal("no local listener")
	}

	conn, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)))
	if err != nil {
		t.Fatalf("dial the forward: %v", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	got := make([]byte, total)
	n, err := io.ReadFull(conn, got)
	if err != nil {
		t.Fatalf("response stopped after %d of %d bytes: %v", n, total, err)
	}
	for i := range got {
		if got[i] != payload[i] {
			t.Fatalf("byte %d differs: got %d want %d", i, got[i], payload[i])
		}
	}
}
