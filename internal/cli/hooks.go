package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agenthooks"
)

// `byspace hooks <agent> <event>` records agent hook activity.
//
// Ported from commands/hooks.ts. Each provider CLI runs this from its own hook configuration when
// a turn starts, stops, or asks the user something; the daemon turns it into the terminal's
// running indicator. Without the shim the terminal shows a shell that is idle while an agent is
// working inside it, which is the opposite of what the indicator is for.
//
// The mapping is coarse and per-event on purpose: the installed extension has more context (for
// pi it distinguishes an idle-time dialog close from a run), and this path is only for providers
// whose hook system gives nothing but an event name.

// hookEventStates maps a provider's event names onto activity states.
var hookEventStates = map[string]map[string]string{
	"pi": {
		"agent_start":      "running",
		"ui_prompt_start":  "needs-input",
		"ui_prompt_end":    "running",
		"agent_settled":    "idle",
		"session_shutdown": "idle",
	},
	"claude": {
		"UserPromptSubmit": "running",
		"Stop":             "idle",
		"StopFailure":      "idle",
		"SessionEnd":       "idle",
	},
	"codex": {
		"UserPromptSubmit":  "running",
		"PreToolUse":        "running",
		"PostToolUse":       "running",
		"PermissionRequest": "needs-input",
		"Stop":              "idle",
	},
	"opencode": {
		"session.status.busy":  "running",
		"session.status.retry": "running",
		"session.status.idle":  "idle",
		"permission.asked":     "needs-input",
		"permission.replied":   "running",
	},
}

// hookTarget is where the shim reports.
type hookTarget struct {
	terminalID string
	token      string
	url        string
}

// resolveHookTarget reads the environment the daemon exports into the terminal.
func resolveHookTarget(env func(string) string) hookTarget {
	return hookTarget{
		terminalID: strings.TrimSpace(env("BYSPACE_TERMINAL_ID")),
		token:      strings.TrimSpace(env("BYSPACE_ACTIVITY_TOKEN")),
		url:        strings.TrimSpace(env("BYSPACE_TERMINAL_ACTIVITY_URL")),
	}
}

// runHooks posts one activity event.
func runHooks(args []string, stdout io.Writer) error {
	// `--install` / `--uninstall` act on the calling user's agent configuration; without one the
	// command is the shim an installed hook runs. Two different jobs under one name because that is
	// how the node CLI exposed it, and the hook command has to stay short.
	for _, argument := range args {
		switch argument {
		case "--install":
			return runHookInstall(stdout, false)
		case "--uninstall":
			return runHookInstall(stdout, true)
		}
	}
	if len(args) < 2 {
		return errors.New("usage: byspace hooks <agent> <event>  (or: byspace hooks --install|--uninstall)")
	}
	provider := strings.ToLower(strings.TrimSpace(args[0]))
	event := strings.TrimSpace(args[1])

	target := resolveHookTarget(os.Getenv)
	if target.terminalID == "" || target.token == "" || target.url == "" {
		// Not running inside a BySpace terminal: the hook fired somewhere else, which is not an
		// error the user should see (it would print on every prompt in their own shell).
		return nil
	}

	state, ok := hookEventStates[provider][event]
	if !ok {
		// An unknown event is ignored rather than reported as running: guessing "running" would
		// leave the indicator stuck on for a provider whose events we do not understand.
		return nil
	}

	// The payload is drained but not required: some providers write a JSON body, others nothing.
	// An unread stdin pipe would leave the provider's hook process blocked.
	_, _ = io.Copy(io.Discard, io.LimitReader(os.Stdin, 1<<20))

	body, err := json.Marshal(map[string]any{
		"terminalId": target.terminalID,
		"token":      target.token,
		"state":      state,
		"provider":   provider,
		"event":      event,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+target.token)

	// No proxy: the hook always talks to its own daemon over loopback.
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Do(req)
	if err != nil {
		// The daemon may be restarting; a failed hook must never fail the agent's turn.
		fmt.Fprintf(stdout, "activity report skipped: %v\n", err)
		return nil
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	return nil
}

// runHookInstall installs or removes the hooks for every supported provider.
//
// One failing provider does not stop the others: a broken claude settings file must not prevent
// codex hooks from working, and the report says which one failed and why.
func runHookInstall(stdout io.Writer, uninstall bool) error {
	action := "Installed"
	results := agenthooks.InstallAll()
	if uninstall {
		action = "Removed"
		results = agenthooks.UninstallAll()
	}

	failures := 0
	for _, provider := range agenthooks.Providers {
		err := results[provider.ID]
		if err != nil {
			failures++
			fmt.Fprintf(stdout, "%s: failed — %v\n", provider.ID, err)
			continue
		}
		fmt.Fprintf(stdout, "%s: %s\n", provider.ID, strings.ToLower(action))
	}
	if failures > 0 {
		return fmt.Errorf("%d provider(s) failed", failures)
	}
	return nil
}
