package daemon

import (
	"context"
	"path/filepath"

	"byspace/internal/agent"
	"byspace/internal/provider/pi"
)

func newAgentManager(ctx context.Context, home string) (*agent.Manager, error) {
	return agent.OpenManager(ctx, map[string]agent.Provider{
		"pi": pi.New(pi.Options{
			SessionDir: filepath.Join(home, "providers", "pi", "sessions"),
		}),
	}, filepath.Join(home, "state", "agents-v1.json"))
}
