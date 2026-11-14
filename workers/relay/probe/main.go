// Command relayprobe checks that a relay preserves per-socket message order.
//
// The hosted relay runs on Durable Objects, which dispatch WebSocket message events concurrently.
// Any `await` inside the message handler therefore lets a later frame overtake an earlier one, and
// every byte stream crossing the relay (terminal output, file-transfer chunks, tunnel data) arrives
// scrambled. Local workerd serializes those events, so no local test can catch it — this probe has
// to point at a deployed build.
//
//	go run ./workers/relay/probe -url wss://app.byspace.cc.cd/ws -n 300
//
// It exits 1 when any frame lands out of place.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/coder/websocket"
)

func main() {
	url := flag.String("url", "wss://app.byspace.cc.cd/ws", "relay /ws endpoint")
	count := flag.Int("n", 300, "frames to send")
	binary := flag.Bool("binary", false, "send binary frames instead of text")
	flag.Parse()

	if err := run(*url, *count, *binary); err != nil {
		fmt.Fprintln(os.Stderr, "relayprobe:", err)
		os.Exit(1)
	}
}

func run(url string, count int, binary bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	// A fresh room per run, so nothing else is listening on these sockets.
	serverID := fmt.Sprintf("orderprobe%d", time.Now().UnixNano()%1e9)
	server, _, err := websocket.Dial(ctx, url+"?serverId="+serverID+"&role=server&v=1", nil)
	if err != nil {
		return fmt.Errorf("server socket: %w", err)
	}
	defer server.CloseNow()
	server.SetReadLimit(8 << 20)

	client, _, err := websocket.Dial(ctx, url+"?serverId="+serverID+"&role=client&v=1", nil)
	if err != nil {
		return fmt.Errorf("client socket: %w", err)
	}
	defer client.CloseNow()

	received := make(chan []int, 1)
	go func() {
		order := make([]int, 0, count)
		for len(order) < count {
			_, data, readErr := server.Read(ctx)
			if readErr != nil {
				break
			}
			if value, convErr := strconv.Atoi(string(data)); convErr == nil {
				order = append(order, value)
			}
		}
		received <- order
	}()

	// Let both sockets finish registering before the burst, so the frames race the relay's
	// dispatch rather than the handshake.
	time.Sleep(500 * time.Millisecond)
	messageType := websocket.MessageText
	if binary {
		messageType = websocket.MessageBinary
	}
	for i := 1; i <= count; i++ {
		if err := client.Write(ctx, messageType, []byte(strconv.Itoa(i))); err != nil {
			return fmt.Errorf("write %d: %w", i, err)
		}
	}

	var order []int
	select {
	case order = <-received:
	case <-ctx.Done():
		return fmt.Errorf("timed out with %d of %d frames", len(order), count)
	}

	outOfPlace := 0
	first := ""
	for index, value := range order {
		if value != index+1 {
			outOfPlace++
			if first == "" {
				first = fmt.Sprintf("index %d: got %d, want %d", index, value, index+1)
			}
		}
	}
	fmt.Printf("client->server sent=%d received=%d out_of_place=%d\n", count, len(order), outOfPlace)
	if outOfPlace > 0 {
		return fmt.Errorf("relay reorders client->server frames, first at %s", first)
	}

	// The handshake's first frame travels server -> client (the daemon's challenge), so the reverse
	// direction needs the same order check.
	clientReceived := make(chan []int, 1)
	go func() {
		order := make([]int, 0, count)
		for len(order) < count {
			_, data, readErr := client.Read(ctx)
			if readErr != nil {
				break
			}
			if value, convErr := strconv.Atoi(string(data)); convErr == nil {
				order = append(order, value)
			}
		}
		clientReceived <- order
	}()

	time.Sleep(100 * time.Millisecond)
	for i := 1; i <= count; i++ {
		if err := server.Write(ctx, messageType, []byte(strconv.Itoa(i))); err != nil {
			return fmt.Errorf("write %d: %w", i, err)
		}
	}

	var reverse []int
	select {
	case reverse = <-clientReceived:
	case <-ctx.Done():
		return fmt.Errorf("timed out with %d of %d reverse frames", len(reverse), count)
	}

	reverseOutOfPlace := 0
	reverseFirst := ""
	for index, value := range reverse {
		if value != index+1 {
			reverseOutOfPlace++
			if reverseFirst == "" {
				reverseFirst = fmt.Sprintf("index %d: got %d, want %d", index, value, index+1)
			}
		}
	}
	fmt.Printf("server->client sent=%d received=%d out_of_place=%d\n", count, len(reverse), reverseOutOfPlace)
	if reverseOutOfPlace > 0 {
		return fmt.Errorf("relay reorders server->client frames, first at %s", reverseFirst)
	}
	return nil
}
