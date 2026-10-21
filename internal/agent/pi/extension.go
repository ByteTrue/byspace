package pi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Marker prefixes the pi integration extension emits through `ctx.ui.notify`. They are the only
// channel an extension has for reporting data back to the host, so the daemon parses them out of
// the notification stream.
const (
	EntryCaptureMarker       = "BYSPACE_ENTRY_CAPTURE"
	SubmittedUserEntryMarker = "BYSPACE_SUBMITTED_USER_ENTRY"
	CommandResultMarker      = "BYSPACE_COMMAND_RESULT"

	// TreeExtensionCommand is the slash command whose payload asks pi to navigate its
	// conversation tree — the mechanism rewind is built on, since pi exposes no RPC for it.
	TreeExtensionCommand = "byspace_tree"
	// CaptureExtensionCommand asks the extension to emit the current entry list.
	CaptureExtensionCommand = "byspace_capture"
)

// piIntegrationExtension is the pi extension source generated per agent.
//
// Ported from createPiBySpaceExtensionFile in archive/.../providers/pi/agent.ts. It exists
// because pi exposes two things only through extensions: entry capture (which user message
// carries which tree entry id) and tree navigation (rewind). Without it, `agent.rewind` cannot
// work at all — the Go daemon previously faked it by truncating its in-memory timeline, which
// changes nothing in the provider and is lost on the next hydration.
const piIntegrationExtension = `
function decodePayload(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function readTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

function getCapturedUserEntries(ctx) {
  return ctx.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "message" && entry.message?.role === "user")
    .map(toCapturedUserEntry);
}

function toCapturedUserEntry(entry) {
  return {
    id: entry.id,
    parentId: entry.parentId ?? null,
    text: readTextContent(entry.message.content),
  };
}

function emitEntryCapture(ctx, reason, requestId) {
  ctx.ui.notify(
    "BYSPACE_ENTRY_CAPTURE " + JSON.stringify({ reason, requestId, entries: getCapturedUserEntries(ctx) }),
    "info",
  );
}

function emitCommandResult(ctx, requestId, result) {
  ctx.ui.notify(
    "BYSPACE_COMMAND_RESULT " + JSON.stringify({ requestId, ...result }),
    result.ok ? "info" : "error",
  );
}

export default function byspaceIntegration(pi) {
  const byspaceMcpServers = __BYSPACE_MCP_SERVERS__;
  const rejectedMcpServers = [];
  if (typeof pi.registerMcpServer === "function") {
    for (const [name, config] of Object.entries(byspaceMcpServers)) {
      // A duplicate name or an invalid config throws; the rest of this extension must still
      // load, or entry capture and tree navigation break too.
      try {
        pi.registerMcpServer(name, config);
      } catch (error) {
        rejectedMcpServers.push({ name, message: error && error.message ? error.message : String(error) });
      }
    }
  }

  // Pi only connects registered MCP servers while its built-in MCP support is loaded. Another
  // extension that owns the "mcp" command replaces it, leaving these registrations stranded.
  function reportMcpInjection(ctx) {
    for (const rejected of rejectedMcpServers) {
      ctx.ui.notify(
        'BySpace could not register MCP server "' + rejected.name + '": ' + rejected.message,
        "warning",
      );
    }
  }

  const submittedUserMessages = [];

  function emitSubmittedUserEntries(ctx) {
    const entries = ctx.sessionManager.getEntries();
    for (let index = 0; index < submittedUserMessages.length; index += 1) {
      const message = submittedUserMessages[index];
      // Pi assigns the entry ID after message_end and then persists this same message object.
      // Reference equality preserves the association even when another extension edits it.
      const entry = entries.find(
        (candidate) => candidate.type === "message" && candidate.message === message,
      );
      if (!entry) {
        continue;
      }
      submittedUserMessages.splice(index, 1);
      index -= 1;
      ctx.ui.notify(
        "BYSPACE_SUBMITTED_USER_ENTRY " + JSON.stringify({ entry: toCapturedUserEntry(entry) }),
        "info",
      );
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    emitEntryCapture(ctx, "session_start");
    reportMcpInjection(ctx);
  });

  pi.on("message_end", async (event) => {
    if (event.message?.role === "user") {
      submittedUserMessages.push(event.message);
    }
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message?.role === "assistant") {
      emitSubmittedUserEntries(ctx);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    emitSubmittedUserEntries(ctx);
    emitEntryCapture(ctx, "turn_end");
  });

  pi.registerCommand("byspace_capture", {
    description: "Internal BySpace entry capture bridge",
    handler: async (args, ctx) => {
      const payload = decodePayload(args.trim());
      emitEntryCapture(ctx, "command", payload.requestId);
    },
  });

  pi.registerCommand("byspace_tree", {
    description: "Internal BySpace tree navigation bridge",
    handler: async (args, ctx) => {
      const payload = decodePayload(args.trim());
      try {
        const result = await ctx.navigateTree(payload.targetId, { summarize: false });
        emitEntryCapture(ctx, "tree_navigation");
        emitCommandResult(ctx, payload.requestId, { ok: true, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitCommandResult(ctx, payload.requestId, { ok: false, error: message });
        throw error;
      }
    },
  });
}
`

// MCPConfig is one MCP server the agent should connect to.
//
// pi has no launch flag for MCP: servers are registered through `pi.registerMcpServer` inside an
// extension, so the daemon's own bridge has to arrive the same way. Without this the agent had
// no orchestration tools at all — `byspace mcp-bridge` existed and nothing ever called it.
type MCPConfig struct {
	Name string `json:"name"`
	// Command/Args describe a stdio server (the bridge is our own binary).
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	// URL describes a remote server instead.
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// ExtensionOptions are the per-agent pieces baked into the generated extension.
type ExtensionOptions struct {
	MCPServers   []MCPConfig
	SystemPrompt string
}

// WriteIntegrationExtension materialises the extension into a temp dir and returns its path
// plus a cleanup function. Each agent gets its own copy: the MCP registrations and system
// prompt it carries belong to that agent.
func WriteIntegrationExtension(opts ExtensionOptions) (string, func(), error) {
	// An explicit override wins, which is how a user can inspect or patch the bridge.
	if override := strings.TrimSpace(os.Getenv("BYSPACE_PI_EXTENSION_PATH")); override != "" {
		return override, func() {}, nil
	}

	mcpJSON, err := json.Marshal(buildPIMCPServers(opts.MCPServers))
	if err != nil {
		return "", nil, err
	}
	source := strings.ReplaceAll(piIntegrationExtension, "__BYSPACE_MCP_SERVERS__", string(mcpJSON))
	if prompt := strings.TrimSpace(opts.SystemPrompt); prompt != "" {
		promptJSON, _ := json.Marshal("\n\n" + prompt)
		source = strings.Replace(source,
			`  pi.on("session_start", async (_event, ctx) => {`,
			`  pi.on("before_agent_start", async (event) => ({
    systemPrompt: event.systemPrompt + `+string(promptJSON)+`,
  }));

  pi.on("session_start", async (_event, ctx) => {`, 1)
	}

	dir, err := os.MkdirTemp("", "byspace-pi-extension-")
	if err != nil {
		return "", nil, err
	}
	path := filepath.Join(dir, "byspace-integration.mjs")
	if err := os.WriteFile(path, []byte(strings.TrimLeft(source, "\n")), 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return "", nil, err
	}
	return path, func() { _ = os.RemoveAll(dir) }, nil
}

// buildPIMCPServers converts daemon MCP configs into pi's shape.
//
// pi takes `{command, args, env}` for stdio and `{url, headers}` for remote; an unknown extra
// key makes registration throw, which the extension reports instead of silently dropping.
func buildPIMCPServers(configs []MCPConfig) map[string]any {
	out := make(map[string]any, len(configs))
	for _, cfg := range configs {
		if cfg.Name == "" {
			continue
		}
		if cfg.URL != "" {
			entry := map[string]any{"url": cfg.URL}
			if len(cfg.Headers) > 0 {
				entry["headers"] = cfg.Headers
			}
			out[cfg.Name] = entry
			continue
		}
		if cfg.Command == "" {
			continue
		}
		entry := map[string]any{"command": cfg.Command}
		if len(cfg.Args) > 0 {
			entry["args"] = cfg.Args
		}
		if len(cfg.Env) > 0 {
			entry["env"] = cfg.Env
		}
		out[cfg.Name] = entry
	}
	return out
}
