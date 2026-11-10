package providers

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/agent/sdk"
	"github.com/ByteTrue/byspace/internal/execres"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/proc"
)

// openCodeModelsTimeout bounds `opencode models`. The command may start OpenCode's local service,
// which is slower than a bare --version but must not hold the provider sheet open.
const openCodeModelsTimeout = 15 * time.Second

// ProbeOpenCodeModels lists the models OpenCode reports for a directory.
//
// OpenCode has no static catalog: which providers and models exist depends on its own config,
// credentials and environment. The CLI's `models` command is the surface that already applies all
// of that, and unlike the HTTP API it is the same on both the v1 and v2 server protocols.
//
// shortcut: the command prints provider/model ids with no display names or thinking variants, so
// labels are derived from the id and no variant picker is offered; switch to the server's model
// listing when OpenCode's own names and variants become required.
func ProbeOpenCodeModels(ctx context.Context, command, cwd string) []sdk.CatalogModel {
	command = strings.TrimSpace(command)
	if command == "" {
		command = "opencode"
	}
	if strings.HasPrefix(command, "http://") || strings.HasPrefix(command, "https://") {
		// The user pointed the provider at an already-running server; `models` is a CLI call.
		return nil
	}
	executable := execres.Find(ctx, command)
	if executable == "" {
		return nil
	}

	probeCtx, cancel := context.WithTimeout(ctx, openCodeModelsTimeout)
	defer cancel()
	cmd := proc.CommandContext(probeCtx, executable, "models")
	if dir := strings.TrimSpace(cwd); dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			cmd.Dir = dir
		}
	}
	cmd.Env = execres.AppendStandardDirs(home.ExternalProcessEnv(os.Environ()))
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	return parseOpenCodeModels(output)
}

// parseOpenCodeModels turns `opencode models` output into catalog entries.
//
// The command prints one `provider/model` per line, but a warning or update notice shares stdout on
// some versions; anything that is not a single token containing a slash is not a model id.
func parseOpenCodeModels(output []byte) []sdk.CatalogModel {
	seen := make(map[string]bool)
	models := make([]sdk.CatalogModel, 0, 16)
	for _, line := range strings.Split(string(output), "\n") {
		id := strings.TrimSpace(line)
		if id == "" || seen[id] || !strings.Contains(id, "/") || strings.ContainsAny(id, " \t") {
			continue
		}
		seen[id] = true
		models = append(models, sdk.CatalogModel{
			ID:           id,
			Label:        openCodeModelLabel(id),
			Provider:     "opencode",
			IsSelectable: true,
		})
	}
	return models
}

// openCodeModelLabel is the last segment of a provider/model id.
func openCodeModelLabel(id string) string {
	if index := strings.LastIndex(id, "/"); index >= 0 && index+1 < len(id) {
		return id[index+1:]
	}
	return id
}
