package providers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/execres"
	"github.com/ByteTrue/byspace/internal/proc"
)

func ListACPSessions(ctx context.Context, cfg LaunchConfig, spec ProviderSpec, command, cwd string, limit int) ([]sdk.ImportableSession, error) {
	if limit <= 0 {
		limit = 50
	}
	bin := strings.TrimSpace(command)
	args := append([]string(nil), spec.DefaultArgs...)
	if bin == "" {
		bin = spec.Binary
	}
	if resolved := execres.Find(ctx, bin); resolved != "" {
		bin = resolved
	}
	cmd := proc.Command(bin, args...)
	cmd.Dir = cwd
	if len(cfg.Env) > 0 {
		cmd.Env = cfg.Env
	} else {
		cmd.Env = os.Environ()
	}
	cmd.Env = execres.AppendStandardDirs(cmd.Env)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	s := &ACPSession{provider: spec.ID, cmd: cmd, stdin: stdin, cwd: cwd, pending: make(map[int64]chan map[string]any), eventSubscribers: make(map[int]func(map[string]any)), pendingPermissions: make(map[string]map[string]any), permissionRPCIDs: make(map[string]any), waitDone: make(chan struct{}), activeTextIdx: -1, activeThinkIdx: -1, activeUserTextIdx: -1, toolIndexByID: make(map[string]int), status: "idle"}
	s.frames = sdk.NewStreamFrames(func() {})
	go s.readLoop(stdout)
	go func() { _ = cmd.Wait(); close(s.waitDone) }()
	defer s.Close()
	initialized, err := s.rpcCall(ctx, "initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": acpClientCapabilities(cfg.ProviderConfig)})
	if err != nil {
		return nil, fmt.Errorf("acp initialize: %w", err)
	}
	capabilities, _ := initialized["agentCapabilities"].(map[string]any)
	sessionCapabilities, _ := capabilities["sessionCapabilities"].(map[string]any)
	if sessionCapabilities["list"] == nil {
		return []sdk.ImportableSession{}, nil
	}
	entries := make([]sdk.ImportableSession, 0, limit)
	seen, cursors := map[string]bool{}, map[string]bool{}
	cursor := ""
	for len(entries) < limit && len(seen) < 500 {
		params := map[string]any{}
		if cwd != "" {
			params["cwd"] = cwd
		}
		if cursor != "" {
			params["cursor"] = cursor
		}
		response, err := s.rpcCall(ctx, "session/list", params)
		if err != nil {
			return nil, err
		}
		rows, _ := response["sessions"].([]any)
		for _, raw := range rows {
			row, _ := raw.(map[string]any)
			id, _ := row["sessionId"].(string)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			rowCwd, _ := row["cwd"].(string)
			title, _ := row["title"].(string)
			updated, _ := row["updatedAt"].(string)
			if updated == "" {
				updated = time.Unix(0, 0).UTC().Format(time.RFC3339Nano)
			}
			entries = append(entries, sdk.ImportableSession{Provider: cfg.Provider, ProviderLabel: spec.Label, ProviderHandleID: id, Cwd: rowCwd, Title: title, LastActivityAt: updated})
			if len(entries) >= limit {
				break
			}
		}
		next, _ := response["nextCursor"].(string)
		if next == "" || cursors[next] || len(rows) == 0 {
			break
		}
		cursors[next] = true
		cursor = next
	}
	return entries, nil
}

func (s *ACPSession) LoadNativeHistory(ctx context.Context) error {
	s.flushFramesOnTimer()
	return nil
}
