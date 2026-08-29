import { test, expect, type Page } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { waitForTerminalAttached } from "./helpers/terminal-perf";
import { selectWorkspaceInSidebar } from "./helpers/sidebar";
import { createTempGitRepo } from "./helpers/workspace";

/**
 * Regression: switching workspaces must not rebuild the Terminal renderer.
 *
 * The emulator used to be unmounted whenever its workspace lost focus, so every switch back
 * rebuilt xterm and its WebGL renderer, replayed the whole mount fit ladder, and churned the
 * column count (measured: 107 → 106 → 107 → 112) before settling. The pane is retained, so the
 * renderer has to survive the round trip: one xterm instance, no PTY resize, same geometry.
 */

type TrackedTerminal = NonNullable<Window["__byspaceTerminal"]>;

interface TerminalProbeWindow extends Window {
  __retainedTerminalInstances?: Set<TrackedTerminal>;
  __terminalResizeFrames?: string[];
}

// A minimal alternate-screen TUI: it repaints a full-width ruler on every SIGWINCH, exactly
// like an agent CLI does, so the painted width can be compared against the renderer's.
const TUI_SCRIPT = `
process.stdout.write("\\x1b[?1049h");
const draw = () => {
  process.stdout.write("\\x1b[2J\\x1b[H" + "-".repeat(process.stdout.columns));
};
process.stdout.on("resize", draw);
draw();
setInterval(() => {}, 1000);
`;

async function installTerminalProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as TerminalProbeWindow;
    const instances = new Set<TrackedTerminal>();
    let current: TrackedTerminal | undefined;
    win.__retainedTerminalInstances = instances;
    Object.defineProperty(win, "__byspaceTerminal", {
      configurable: true,
      get: () => current,
      set: (terminal: TrackedTerminal | undefined) => {
        current = terminal;
        if (terminal) {
          instances.add(terminal);
        }
      },
    });

    // Resize claims travel as binary terminal-stream frames with a JSON payload, so the decoded
    // bytes are enough to count them without pulling in the protocol codec.
    const resizeFrames: string[] = [];
    win.__terminalResizeFrames = resizeFrames;
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data !== "string") {
        try {
          const match = new TextDecoder()
            .decode(data as ArrayBuffer)
            .match(/\{"rows":\d+,"cols":\d+\}/);
          if (match) {
            resizeFrames.push(match[0]);
          }
        } catch {
          // Binary frames that are not UTF-8 are not resize claims.
        }
      }
      originalSend.call(this, data);
    };
  });
}

interface TerminalRetentionState {
  instanceCount: number;
  cols: number;
  ruler: number;
  claimedSizes: string[];
}

async function readRetentionState(page: Page): Promise<TerminalRetentionState> {
  return await page.evaluate(() => {
    const win = window as TerminalProbeWindow;
    const instances = Array.from(win.__retainedTerminalInstances ?? []) as {
      cols: number;
      element?: HTMLElement;
      buffer: {
        active: {
          length: number;
          getLine: (index: number) => { translateToString: (trim: boolean) => string } | null;
        };
      };
    }[];
    const visible = instances.find((terminal) => terminal.element?.offsetParent !== null);
    let ruler = -1;
    if (visible) {
      const buffer = visible.buffer.active;
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index)?.translateToString(true).trimEnd() ?? "";
        if (/^-{10,}$/.test(line)) {
          ruler = line.length;
        }
      }
    }
    return {
      instanceCount: instances.length,
      cols: visible?.cols ?? -1,
      ruler,
      claimedSizes: [...new Set(win.__terminalResizeFrames ?? [])],
    };
  });
}

test.describe("terminal workspace switch retention", () => {
  let harness: TerminalE2EHarness;

  test.beforeEach(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-switch-retention" });
  });

  test.afterEach(async () => {
    await harness.cleanup();
  });

  test("a workspace round trip keeps the same renderer and claims no new size", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await installTerminalProbe(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const otherRepo = await createTempGitRepo("terminal-switch-retention-other");
    const otherWorkspace = await harness.client.createWorkspace({
      source: { kind: "directory", path: otherRepo.path },
    });
    const otherWorkspaceId = otherWorkspace.workspace?.id;
    if (!otherWorkspaceId) {
      throw new Error(otherWorkspace.error ?? "Failed to seed the second workspace");
    }

    const terminal = await harness.createTerminal({
      name: "retention-tui",
      command: "node",
      args: ["-e", TUI_SCRIPT],
    });
    try {
      await harness.openTerminal(page, { terminalId: terminal.id });
      await waitForTerminalAttached(page);
      await expect
        .poll(
          async () => {
            const { cols, ruler } = await readRetentionState(page);
            return `${ruler}/${cols}`;
          },
          { timeout: 20_000 },
        )
        .toMatch(/^(\d+)\/\1$/);
      // Let the whole mount refit ladder finish before taking the baseline.
      await page.waitForTimeout(2_500);
      // Startup itself constructs a few instances while the route and terminal id settle, so
      // the assertion below is on the delta across the switch, not the absolute count.
      const before = await readRetentionState(page);

      await selectWorkspaceInSidebar(page, otherWorkspaceId);
      await page.waitForTimeout(1_500);
      await selectWorkspaceInSidebar(page, harness.workspaceId);
      await page.waitForTimeout(3_000);

      const after = await readRetentionState(page);

      // The renderer survived: the round trip constructed no new xterm...
      expect(after.instanceCount).toBe(before.instanceCount);
      // ...so the geometry never moved. Re-subscribing re-asserts the size the pane already
      // claimed (idempotent: an unchanged TIOCSWINSZ raises no SIGWINCH), but no new size was
      // ever sent.
      expect(after.cols).toBe(before.cols);
      expect(after.ruler).toBe(after.cols);
      expect(after.claimedSizes).toEqual(before.claimedSizes);
      expect(after.claimedSizes).toHaveLength(1);
    } finally {
      await harness.killTerminal(terminal.id);
      await otherRepo.cleanup().catch(() => {});
    }
  });
});
