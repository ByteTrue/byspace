package agenthooks

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

// openCodePluginMarker identifies the plugin file as ours.
//
// A plugin file is the whole file, not an entry in a list, so the marker is the first line. Without
// it a user's own `byspace-terminal-activity.js` would be overwritten: same name, different code.
const openCodePluginMarker = "// Installed by BySpace for terminal activity reporting."

// openCodePluginSource is the plugin opencode loads.
//
// The plugin's job is narrow: turn opencode's session and permission events into `byspace hooks`
// calls. It enqueues reports instead of firing them inline so an older "busy" report cannot land
// after a newer "idle" one and leave the indicator stuck on running.
const openCodePluginSource = openCodePluginMarker + `
const providers = ["opencode"];

const events = {
  "session.status.busy": "running",
  "session.status.retry": "running",
  "session.status.idle": "idle",
  "permission.asked": "needs-input",
  "permission.replied": "running",
};

// Serialised so reports keep their order: without the queue an old busy report can arrive after
// an idle one and the indicator shows a finished agent as still working.
let chain = Promise.resolve();

function report(event) {
  const state = events[event];
  if (!state) return;
  if (!process.env.BYSPACE_TERMINAL_ID) return;
  chain = chain
    .then(async () => {
      const { spawn } = await import("node:child_process");
      const cli = process.env.BYSPACE_HOOK_CLI || "byspace";
      await new Promise((resolve) => {
        const child = spawn(cli, ["hooks", "opencode", event], { stdio: "ignore" });
        child.on("exit", resolve);
        child.on("error", resolve);
      });
    })
    .catch(() => undefined);
}

export const BySpaceTerminalActivity = async () => ({
  event: async ({ event }) => {
    if (!event || typeof event.type !== "string") return;
    report(event.type);
  },
});

export default BySpaceTerminalActivity;
`

// installPluginFile writes the opencode plugin.
func installPluginFile(p Provider) error {
	path, err := p.ConfigPath()
	if err != nil {
		return err
	}

	// Refuse to overwrite a file we did not write: same filename, possibly the user's own plugin.
	if existing, readErr := os.ReadFile(path); readErr == nil {
		if !strings.Contains(string(existing), openCodePluginMarker) {
			return fmt.Errorf(
				"%s exists and was not written by BySpace; move it aside to let BySpace install its hooks", path)
		}
		if string(existing) == openCodePluginSource {
			return nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return home.WriteAtomic(path, []byte(openCodePluginSource), 0o644)
}

// uninstallPluginFile removes the plugin if it is ours.
func uninstallPluginFile(p Provider) error {
	path, err := p.ConfigPath()
	if err != nil {
		return err
	}
	existing, readErr := os.ReadFile(path)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			return nil
		}
		return readErr
	}
	if !strings.Contains(string(existing), openCodePluginMarker) {
		// Not ours: leave it. Deleting someone else's plugin because it shares a name would be
		// the same mistake as overwriting it.
		return nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
