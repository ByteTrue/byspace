package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

// `byspace attach` streams a running agent's output to the terminal.
//
// Ported from commands/agent/attach.ts. It is the difference between "start a task and check on
// it later" and "watch it work": `run` waits for the turn to end, `attach` prints as it goes, and
// can be attached to an agent that is already running.
//
// The id is matched by prefix, because the full ids are long and the user copies them from `ls`
// output that truncates in a narrow terminal.

// attachOptions are the flags for `byspace attach`.
type attachOptions struct {
	addr    string
	agentID string
	// noFollow prints the existing history and exits, for a script or a quick check.
	noFollow bool
}

// parseAttachArgs reads the flags.
func parseAttachArgs(args []string) (attachOptions, error) {
	fs := flag.NewFlagSet("attach", flag.ContinueOnError)
	opts := attachOptions{}
	fs.StringVar(&opts.addr, "addr", defaultListenAddr(), "daemon address")
	fs.BoolVar(&opts.noFollow, "no-follow", false, "print history and exit")
	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	if fs.NArg() < 1 {
		return opts, errors.New("agent-id is required")
	}
	opts.agentID = fs.Arg(0)
	return opts, nil
}

// runAttach streams an agent's timeline.
func runAttach(args []string, stdout io.Writer) error {
	opts, err := parseAttachArgs(args)
	if err != nil {
		return err
	}

	// Follow until interrupted; a plain `attach` is meant to be left running.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupt)
	go func() {
		select {
		case <-interrupt:
			cancel()
		case <-ctx.Done():
		}
	}()

	dialCtx, dialCancel := context.WithTimeout(ctx, 10*time.Second)
	ws, err := dialDaemonWS(dialCtx, opts.addr)
	dialCancel()
	if err != nil {
		return err
	}
	defer ws.CloseNow()

	agentID, err := resolveAgentID(ctx, ws, opts.agentID)
	if err != nil {
		return err
	}

	// Backfill first: a user attaching to a running agent needs the context that led here, not
	// only what happens next.
	if err := printTimelineHistory(ctx, ws, agentID, stdout); err != nil {
		return err
	}
	if opts.noFollow {
		return nil
	}

	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "agent.timeline.set_subscription.request",
		"requestId": "cli_attach_sub",
		"agentIds":  []string{agentID},
	}); err != nil {
		return err
	}
	if _, err := waitSessionResp(ctx, ws, "agent.timeline.set_subscription.response", ""); err != nil {
		return err
	}

	return followAgentStream(ctx, ws, agentID, stdout)
}

// resolveAgentID expands a prefix to a full id.
func resolveAgentID(ctx context.Context, ws *websocket.Conn, prefix string) (string, error) {
	want := strings.TrimSpace(prefix)
	if want == "" {
		return "", errors.New("agent-id is required")
	}
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "fetch_agents_request",
		"requestId": "cli_attach_list",
	}); err != nil {
		return "", err
	}
	resp, err := waitSessionResp(ctx, ws, "fetch_agents_response", "")
	if err != nil {
		return "", err
	}

	var matches []string
	entries, _ := resp["entries"].([]any)
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		agent, _ := entry["agent"].(map[string]any)
		id, _ := agent["id"].(string)
		if id == "" {
			continue
		}
		if id == want {
			// An exact match wins outright, even if it is also a prefix of another id.
			return id, nil
		}
		if strings.HasPrefix(id, want) {
			matches = append(matches, id)
		}
	}
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("no agent matches %q", want)
	case 1:
		return matches[0], nil
	default:
		// Ambiguous prefixes are reported rather than silently picking one: attaching to the
		// wrong agent shows the wrong task's output with no indication.
		return "", fmt.Errorf("%q is ambiguous, matches: %s", want, strings.Join(matches, ", "))
	}
}

// printTimelineHistory prints the timeline the agent already has.
func printTimelineHistory(ctx context.Context, ws *websocket.Conn, agentID string, stdout io.Writer) error {
	if err := sendSessionReq(ctx, ws, map[string]any{
		"type":      "fetch_agent_timeline_request",
		"requestId": "cli_attach_timeline",
		"agentId":   agentID,
	}); err != nil {
		return err
	}
	resp, err := waitSessionResp(ctx, ws, "fetch_agent_timeline_response", "")
	if err != nil {
		return err
	}
	entries, _ := resp["entries"].([]any)
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		printTimelineRaw(entry, stdout)
	}
	return nil
}

// followAgentStream prints items as they arrive until the context is cancelled.
func followAgentStream(ctx context.Context, ws *websocket.Conn, agentID string, stdout io.Writer) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		msgType, data, err := ws.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if msgType != websocket.MessageText {
			continue
		}
		var envelope struct {
			Type    string `json:"type"`
			Message struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			} `json:"message"`
		}
		if json.Unmarshal(data, &envelope) != nil || envelope.Type != "session" {
			continue
		}
		message := map[string]any{"type": envelope.Message.Type, "payload": envelope.Message.Payload}
		if message == nil {
			continue
		}
		msgTypeName, _ := message["type"].(string)
		payload, _ := message["payload"].(map[string]any)

		switch msgTypeName {
		case "agent_stream":
			if id, _ := payload["agentId"].(string); id != "" && id != agentID {
				continue
			}
			event, _ := payload["event"].(map[string]any)
			if event == nil {
				continue
			}
			handleStreamEvent(event, stdout)
		case "agent_update":
			// The turn ending is what the user is waiting for; anything else is noise on a
			// stream they are reading for content.
			agent, _ := payload["agent"].(map[string]any)
			if agent == nil {
				continue
			}
			if id, _ := agent["id"].(string); id != agentID {
				continue
			}
			if status, _ := agent["status"].(string); status == "idle" {
				return nil
			}
		}
	}
}

// handleStreamEvent prints one streamed timeline item.
func handleStreamEvent(event map[string]any, stdout io.Writer) {
	eventType, _ := event["type"].(string)
	switch eventType {
	case "timeline":
		item, _ := event["item"].(map[string]any)
		if item != nil {
			printTimelineRaw(map[string]any{"item": item}, stdout)
		}
	case "turn_completed":
		fmt.Fprintln(stdout)
	}
}

// printTimelineRaw renders one timeline entry.
//
// Assistant text is written without a prefix or newline so a streamed reply reads as prose rather
// than as one line per token; everything else gets a marker the user can scan for.
func printTimelineRaw(entry map[string]any, stdout io.Writer) {
	item, _ := entry["item"].(map[string]any)
	if item == nil {
		return
	}
	itemType, _ := item["type"].(string)
	text, _ := item["text"].(string)

	switch itemType {
	case "assistant_message":
		fmt.Fprint(stdout, text)
	case "user_message":
		fmt.Fprintf(stdout, "\n[User] %s\n", text)
	case "reasoning":
		fmt.Fprintf(stdout, "\n[Reasoning] %s\n", text)
	case "tool_call":
		name, _ := item["name"].(string)
		status, _ := item["status"].(string)
		if status == "" {
			status = "started"
		}
		fmt.Fprintf(stdout, "\n[Tool: %s] %s\n", name, status)
	case "error":
		message, _ := item["message"].(string)
		fmt.Fprintf(stdout, "\n[Error] %s\n", message)
	case "todo":
		items, _ := item["items"].([]any)
		completed := 0
		for _, raw := range items {
			if todo, ok := raw.(map[string]any); ok {
				if done, _ := todo["completed"].(bool); done {
					completed++
				}
			}
		}
		fmt.Fprintf(stdout, "\n[Todo] %d/%d completed\n", completed, len(items))
	default:
		// An unknown item type is skipped rather than printed: a marker with no content is
		// noise in a stream the user is reading.
	}
}
