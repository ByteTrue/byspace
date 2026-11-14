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
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

func main() {
	url := flag.String("url", "wss://app.byspace.cc.cd/ws", "relay /ws endpoint")
	count := flag.Int("n", 300, "frames to send")
	binary := flag.Bool("binary", false, "send binary frames instead of text")
	v2 := flag.Bool("v2", false, "exercise the v2 control/data path (daemon + app)")
	flag.Parse()

	runFn := run
	if *v2 {
		runFn = runV2
	}
	if err := runFn(*url, *count, *binary); err != nil {
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

// runV2 exercises the path a real daemon and app use: a server control channel, a client that
// asks the relay for a connection id, and a server data socket opened with that id. The v1 path
// pairs the sockets by role alone, so it cannot see a broken control -> data handoff.
func runV2(url string, count int, binary bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	serverID := fmt.Sprintf("orderprobe%d", time.Now().UnixNano()%1e9)
	control, _, err := websocket.Dial(ctx, url+"?serverId="+serverID+"&role=server&v=2", nil)
	if err != nil {
		return fmt.Errorf("control socket: %w", err)
	}
	defer control.CloseNow()
	control.SetReadLimit(8 << 20)

	client, _, err := websocket.Dial(ctx, url+"?serverId="+serverID+"&role=client&v=2", nil)
	if err != nil {
		return fmt.Errorf("client socket: %w", err)
	}
	defer client.CloseNow()
	client.SetReadLimit(8 << 20)

	connectionID := ""
	for connectionID == "" {
		_, data, readErr := control.Read(ctx)
		if readErr != nil {
			return fmt.Errorf("control read before connected: %w", readErr)
		}
		var event struct {
			Type         string `json:"type"`
			ConnectionID string `json:"connectionId"`
		}
		if json.Unmarshal(data, &event) == nil && event.Type == "connected" {
			connectionID = strings.TrimSpace(event.ConnectionID)
		}
	}

	server, _, err := websocket.Dial(ctx, url+"?serverId="+serverID+"&role=server&v=2&connectionId="+connectionID, nil)
	if err != nil {
		return fmt.Errorf("server data socket: %w", err)
	}
	defer server.CloseNow()
	server.SetReadLimit(8 << 20)
	messageType := websocket.MessageText
	if binary {
		messageType = websocket.MessageBinary
	}

	// A real daemon writes its E2EE challenge as the first frame on the data socket. Send one
	// immediately and require the app side to read it: a relay that needs a settle delay before a
	// freshly accepted data socket can be routed loses exactly that challenge, and the handshake
	// times out with no password ever submitted.
	immediateCtx, immediateCancel := context.WithTimeout(ctx, 5*time.Second)
	if err := server.Write(immediateCtx, messageType, []byte("immediate")); err != nil {
		immediateCancel()
		return fmt.Errorf("immediate server->client write: %w", err)
	}
	_, immediateData, immediateErr := client.Read(immediateCtx)
	immediateCancel()
	if immediateErr != nil {
		return fmt.Errorf("immediate server->client frame lost: %w", immediateErr)
	}
	if string(immediateData) != "immediate" {
		return fmt.Errorf("immediate server->client frame was %q", string(immediateData))
	}
	fmt.Println("immediate server->client frame delivered")

	// Let the data socket register before the burst.
	time.Sleep(300 * time.Millisecond)
	return checkDirection(ctx, client, server, messageType, count, "client->server", "server->client")
}

// checkDirection writes count frames through one socket and requires the peer to read them in
// order, then does the same in the reverse direction.
func checkDirection(ctx context.Context, sender, receiver *websocket.Conn, messageType websocket.MessageType, count int, forwardLabel, reverseLabel string) error {
	received := make(chan []int, 1)
	go func() {
		order := make([]int, 0, count)
		for len(order) < count {
			_, data, readErr := receiver.Read(ctx)
			if readErr != nil {
				break
			}
			if value, convErr := strconv.Atoi(string(data)); convErr == nil {
				order = append(order, value)
			}
		}
		received <- order
	}()
	for i := 1; i <= count; i++ {
		if err := sender.Write(ctx, messageType, []byte(strconv.Itoa(i))); err != nil {
			return fmt.Errorf("%s write %d: %w", forwardLabel, i, err)
		}
	}
	var order []int
	select {
	case order = <-received:
	case <-ctx.Done():
		return fmt.Errorf("%s timed out with %d of %d frames", forwardLabel, len(order), count)
	}
	if err := checkOrder(order, count, forwardLabel); err != nil {
		return err
	}

	reverse := make(chan []int, 1)
	go func() {
		order := make([]int, 0, count)
		for len(order) < count {
			_, data, readErr := sender.Read(ctx)
			if readErr != nil {
				break
			}
			if value, convErr := strconv.Atoi(string(data)); convErr == nil {
				order = append(order, value)
			}
		}
		reverse <- order
	}()
	for i := 1; i <= count; i++ {
		if err := receiver.Write(ctx, messageType, []byte(strconv.Itoa(i))); err != nil {
			return fmt.Errorf("%s write %d: %w", reverseLabel, i, err)
		}
	}
	select {
	case order = <-reverse:
	case <-ctx.Done():
		return fmt.Errorf("%s timed out with %d of %d frames", reverseLabel, len(order), count)
	}
	return checkOrder(order, count, reverseLabel)
}

func checkOrder(order []int, count int, label string) error {
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
	fmt.Printf("%s sent=%d received=%d out_of_place=%d\n", label, count, len(order), outOfPlace)
	if outOfPlace > 0 {
		return fmt.Errorf("relay reorders %s frames, first at %s", label, first)
	}
	return nil
}
