package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"byspace/internal/daemon"
	"byspace/internal/relay"
	"github.com/coder/websocket"
)

type daemonSocket interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Write(context.Context, websocket.MessageType, []byte) error
	CloseNow() error
}

type localDaemonClient struct {
	socket daemonSocket
}

type singleHostFlag struct {
	value string
	set   bool
}

func (value *singleHostFlag) String() string { return value.value }

func (value *singleHostFlag) Set(host string) error {
	if value.set {
		return errors.New("--host may only be specified once")
	}
	if strings.TrimSpace(host) == "" {
		return errors.New("--host requires a non-empty server ID")
	}
	value.value = host
	value.set = true
	return nil
}

type sessionEnvelope struct {
	Type    string `json:"type"`
	Message struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	} `json:"message"`
}

type agentListPayload struct {
	RequestID string `json:"requestId"`
	Entries   []struct {
		Agent struct {
			ID       string  `json:"id"`
			Provider string  `json:"provider"`
			CWD      string  `json:"cwd"`
			Status   string  `json:"status"`
			Title    *string `json:"title"`
		} `json:"agent"`
	} `json:"entries"`
}

type timelineEntry struct {
	SeqStart  uint64          `json:"seqStart"`
	Timestamp string          `json:"timestamp"`
	Item      json.RawMessage `json:"item"`
}

type timelinePayload struct {
	RequestID string          `json:"requestId"`
	AgentID   string          `json:"agentId"`
	Epoch     string          `json:"epoch"`
	HasNewer  bool            `json:"hasNewer"`
	Entries   []timelineEntry `json:"entries"`
	Error     any             `json:"error"`
}

func runAgent(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "agent subcommand is required")
		printAgentUsage(stderr)
		return 2
	}
	switch args[0] {
	case "list":
		return runAgentList(args[1:], stdout, stderr)
	case "timeline":
		return runAgentTimeline(args[1:], stdout, stderr)
	case "help", "--help", "-h":
		printAgentUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown agent subcommand %q\n", args[0])
		printAgentUsage(stderr)
		return 2
	}
}

func runAgentList(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace agent list", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	var hostFlag singleHostFlag
	flags.Var(&hostFlag, "host", "saved remote host server ID")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "agent list does not accept positional arguments")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, err := connectSelectedDaemon(ctx, home, hostFlag.value)
	if err != nil {
		return printError(stderr, err)
	}
	defer client.socket.CloseNow()
	requestID := newRequestID()
	if err := client.write(ctx, map[string]any{"type": "fetch_agents_request", "requestId": requestID}); err != nil {
		return printError(stderr, err)
	}
	envelope, err := client.readResponse(ctx, "fetch_agents_response", requestID, nil)
	if err != nil {
		return printError(stderr, err)
	}
	var payload agentListPayload
	if err := json.Unmarshal(envelope.Message.Payload, &payload); err != nil {
		return printError(stderr, fmt.Errorf("decode Agent list: %w", err))
	}
	if *jsonOutput {
		return printJSON(stdout, stderr, payload)
	}
	for _, entry := range payload.Entries {
		title := "-"
		if entry.Agent.Title != nil && *entry.Agent.Title != "" {
			title = *entry.Agent.Title
		}
		fmt.Fprintf(stdout, "%s\t%s\t%s\t%s\t%s\n", entry.Agent.ID, entry.Agent.Status, entry.Agent.Provider, title, entry.Agent.CWD)
	}
	return 0
}

func runAgentTimeline(args []string, stdout, stderr io.Writer) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runAgentTimelineContext(ctx, args, stdout, stderr)
}

func runAgentTimelineContext(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("byspace agent timeline", flag.ContinueOnError)
	flags.SetOutput(stderr)
	homeFlag := flags.String("home", "", "byspace home directory")
	var hostFlag singleHostFlag
	flags.Var(&hostFlag, "host", "saved remote host server ID")
	follow := flags.Bool("follow", false, "continue printing live Timeline rows")
	jsonOutput := flags.Bool("json", false, "write machine-readable JSON")
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		args = append(append([]string{}, args[1:]...), args[0])
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "agent timeline requires one Agent ID")
		return 2
	}
	home, err := daemon.ResolveHome(*homeFlag)
	if err != nil {
		return printError(stderr, err)
	}
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	client, err := connectSelectedDaemon(connectCtx, home, hostFlag.value)
	cancel()
	if err != nil {
		return printError(stderr, err)
	}
	defer client.socket.CloseNow()

	agentID := flags.Arg(0)
	requestCtx, requestCancel := context.WithTimeout(ctx, 5*time.Second)
	probe, err := client.fetchTimeline(requestCtx, agentID, "tail", "", 0, 1)
	requestCancel()
	if err != nil {
		return printError(stderr, fmt.Errorf("fetch Agent Timeline: %w", err))
	}
	epoch := probe.Epoch
	var head uint64
	catchUp := func() error {
		for {
			requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			update, err := client.fetchTimeline(requestCtx, agentID, "after", epoch, head, 32)
			cancel()
			if err != nil {
				return err
			}
			if update.Epoch != "" {
				epoch = update.Epoch
			}
			advanced := false
			for _, entry := range update.Entries {
				if entry.SeqStart <= head {
					continue
				}
				printTimelineEntry(stdout, entry, *jsonOutput)
				head = entry.SeqStart
				advanced = true
			}
			if !update.HasNewer {
				return nil
			}
			if !advanced {
				return errors.New("Timeline page reported newer rows without advancing the cursor")
			}
		}
	}
	if err := catchUp(); err != nil {
		return printError(stderr, fmt.Errorf("fetch Agent Timeline: %w", err))
	}
	if !*follow {
		return 0
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return 0
		case <-ticker.C:
		}
		if err := catchUp(); err != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return 0
			}
			return printError(stderr, fmt.Errorf("follow Agent Timeline: %w", err))
		}
	}
}

func connectSelectedDaemon(ctx context.Context, home, serverID string) (*localDaemonClient, error) {
	if serverID == "" {
		return connectLocalDaemon(ctx, home)
	}
	offer, err := relay.LoadRemoteHost(relay.RemoteHostsPath(home), serverID)
	if err != nil {
		return nil, fmt.Errorf("load remote host %s: %w", serverID, err)
	}
	socket, err := relay.DialEncryptedClient(ctx, offer)
	if err != nil {
		return nil, fmt.Errorf("connect to remote host %s: %w", serverID, err)
	}
	return handshakeDaemon(ctx, socket, serverID)
}

func connectLocalDaemon(ctx context.Context, home string) (*localDaemonClient, error) {
	status, err := daemon.Inspect(ctx, home)
	if err != nil {
		return nil, err
	}
	if status.LocalDaemon != "running" || status.Listen == "" {
		return nil, fmt.Errorf("byspace daemon is not running: %s", status.LocalDaemon)
	}
	endpoint := url.URL{Scheme: "ws", Host: daemon.ReachableAddress(status.Listen), Path: "/ws"}
	socket, response, err := websocket.Dial(ctx, endpoint.String(), nil)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		return nil, fmt.Errorf("connect to local daemon: %w", err)
	}
	// The verified local daemon can emit a single canonical row larger than its
	// 1 MiB inbound request limit (for example, a Pi tool result). Pagination
	// bounds aggregate history responses; individual response rows remain intact.
	socket.SetReadLimit(-1)
	return handshakeDaemon(ctx, socket, status.ServerID)
}

func handshakeDaemon(ctx context.Context, socket daemonSocket, expectedServerID string) (*localDaemonClient, error) {
	client := &localDaemonClient{socket: socket}
	hello := map[string]any{
		"type": "hello", "clientId": "byspace-cli-" + newRequestID(),
		"clientType": "cli", "protocolVersion": 1,
		"capabilities": map[string]any{"agentStream": false},
	}
	if err := writeDaemonJSON(ctx, socket, hello); err != nil {
		socket.CloseNow()
		return nil, fmt.Errorf("send daemon hello: %w", err)
	}
	envelope, err := client.read(ctx)
	if err != nil || envelope.Message.Type != "status" {
		socket.CloseNow()
		if err == nil {
			err = fmt.Errorf("unexpected handshake response %q", envelope.Message.Type)
		}
		return nil, fmt.Errorf("read daemon hello: %w", err)
	}
	var status struct {
		Status   string `json:"status"`
		ServerID string `json:"serverId"`
	}
	if err := json.Unmarshal(envelope.Message.Payload, &status); err != nil || status.Status != "server_info" || status.ServerID != expectedServerID {
		socket.CloseNow()
		return nil, errors.New("daemon handshake identity mismatch")
	}
	return client, nil
}

func (client *localDaemonClient) write(ctx context.Context, message any) error {
	return writeDaemonJSON(ctx, client.socket, map[string]any{"type": "session", "message": message})
}

func writeDaemonJSON(ctx context.Context, socket daemonSocket, message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageText, data)
}

func (client *localDaemonClient) read(ctx context.Context) (sessionEnvelope, error) {
	messageType, data, err := client.socket.Read(ctx)
	if err != nil {
		return sessionEnvelope{}, err
	}
	if messageType != websocket.MessageText {
		return sessionEnvelope{}, errors.New("daemon sent an unexpected binary message")
	}
	var envelope sessionEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return sessionEnvelope{}, err
	}
	return envelope, nil
}

func (client *localDaemonClient) readResponse(ctx context.Context, messageType, requestID string, observe func(sessionEnvelope)) (sessionEnvelope, error) {
	for {
		envelope, err := client.read(ctx)
		if err != nil {
			return sessionEnvelope{}, err
		}
		if observe != nil {
			observe(envelope)
		}
		if envelope.Type != "session" || envelope.Message.Type != messageType {
			continue
		}
		var identity struct {
			RequestID string `json:"requestId"`
		}
		if err := json.Unmarshal(envelope.Message.Payload, &identity); err != nil {
			continue
		}
		if identity.RequestID == requestID {
			return envelope, nil
		}
	}
}

func (client *localDaemonClient) fetchTimeline(ctx context.Context, agentID, direction, epoch string, seq uint64, limit int) (timelinePayload, error) {
	requestID := newRequestID()
	request := map[string]any{
		"type":       "fetch_agent_timeline_request",
		"requestId":  requestID,
		"agentId":    agentID,
		"direction":  direction,
		"projection": "canonical",
		"limit":      limit,
	}
	if direction == "after" {
		request["cursor"] = map[string]any{"epoch": epoch, "seq": seq}
	}
	if err := client.write(ctx, request); err != nil {
		return timelinePayload{}, err
	}
	envelope, err := client.readResponse(ctx, "fetch_agent_timeline_response", requestID, nil)
	if err != nil {
		return timelinePayload{}, err
	}
	var payload timelinePayload
	if err := json.Unmarshal(envelope.Message.Payload, &payload); err != nil {
		return timelinePayload{}, fmt.Errorf("decode response: %w", err)
	}
	if payload.Error != nil {
		return timelinePayload{}, fmt.Errorf("daemon response: %v", payload.Error)
	}
	return payload, nil
}

func printTimelineEntry(output io.Writer, entry timelineEntry, jsonOutput bool) {
	if jsonOutput {
		_ = json.NewEncoder(output).Encode(entry)
		return
	}
	var item struct {
		Type    string `json:"type"`
		Text    string `json:"text"`
		Message string `json:"message"`
		Name    string `json:"name"`
		Status  string `json:"status"`
	}
	_ = json.Unmarshal(entry.Item, &item)
	content := item.Text
	if content == "" {
		content = item.Message
	}
	if content == "" && item.Name != "" {
		content = strings.TrimSpace(item.Name + " " + item.Status)
	}
	fmt.Fprintf(output, "%d\t%s\t%s\n", entry.SeqStart, item.Type, content)
}

func newRequestID() string {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(data[:])
}

func printAgentUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: byspace agent <list|timeline> [options]")
}
