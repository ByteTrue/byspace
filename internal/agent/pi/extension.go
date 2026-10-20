package pi

import (
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

// WriteIntegrationExtension materialises the public.extension into a temp dir and returns its
// path plus a cleanup function. Each agent gets its own copy: another agent's extension instance
// would carry its own session state.
func WriteIntegrationExtension() (string, func(), error) {
	// An explicit override wins, which is how a user can inspect or patch the bridge.
	if override := strings.TrimSpace(os.Getenv("BYSPACE_PI_EXTENSION_PATH")); override != "" {
		return override, func() {}, nil
	}
	dir, err := os.MkdirTemp("", "byspace-pi-extension-")
	if err != nil {
		return "", nil, err
	}
	path := filepath.Join(dir, "byspace-integration.mjs")
	if err := os.WriteFile(path, []byte(strings.TrimLeft(piIntegrationExtension, "\n")), 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return "", nil, err
	}
	return path, func() { _ = os.RemoveAll(dir) }, nil
}
