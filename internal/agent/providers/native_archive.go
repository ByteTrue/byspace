package providers

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// ArchiveNativeSession archives a provider-owned thread without requiring a loaded session.
func ArchiveNativeSession(ctx context.Context, cfg LaunchConfig) (bool, error) {
	return setNativeArchiveState(ctx, cfg, true)
}

// UnarchiveNativeSession restores a provider-owned archived thread before the daemon
// makes its local record runnable. Codex cannot resume an archived thread, so this
// operation uses a short-lived app-server instead of StartCodexSession.
func UnarchiveNativeSession(ctx context.Context, cfg LaunchConfig) (bool, error) {
	return setNativeArchiveState(ctx, cfg, false)
}

func setNativeArchiveState(ctx context.Context, cfg LaunchConfig, archived bool) (bool, error) {
	if strings.TrimSpace(cfg.SessionHandle) == "" {
		return false, nil
	}
	spec, command, argv := resolveProviderLaunch(cfg)
	var commandArgs []string
	if len(argv) > 1 {
		commandArgs = append([]string{}, argv[1:]...)
	}
	switch spec.Protocol {
	case "codex-rpc":
		if command == "" {
			command = "codex"
		}
		env := cfg.Env
		if len(env) == 0 {
			env = os.Environ()
		}
		session, err := probeCodexSessionWithArgs(ctx, command, commandArgs, cfg.Cwd, env)
		if err != nil {
			return true, err
		}
		defer session.Close()
		method := "thread/unarchive"
		if archived {
			method = "thread/archive"
		}
		_, err = session.rpcCall(ctx, method, map[string]any{"threadId": cfg.SessionHandle})
		return true, err
	case "opencode-http":
		session, err := startOpenCodeSessionWithArgs(cfg, command, commandArgs)
		if err != nil {
			return true, err
		}
		defer session.Close()
		return true, archiveOpenCodeNativeSession(ctx, session, archived)
	default:
		return false, nil
	}
}

func archiveOpenCodeNativeSession(ctx context.Context, session ManagedSession, archived bool) error {
	native, ok := session.(interface {
		ArchiveNative(context.Context, bool) error
	})
	if !ok {
		return fmt.Errorf("OpenCode native archive requires the HTTP transport; got %T", session)
	}
	return native.ArchiveNative(ctx, archived)
}
