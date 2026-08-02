import { test, expect, type Page } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { waitForTerminalAttached } from "./helpers/terminal-perf";
import { selectWorkspaceInSidebar } from "./helpers/sidebar";
import { createTempGitRepo } from "./helpers/workspace";

/**
 * How much scrollback survives a workspace switch, and what catching up costs.
 *
 * A returning client is resumed: the daemon sends the output produced while the pane was
 * unsubscribed and the renderer is never reset, so the history the user keeps is their own
 * renderer's, not a replay window. The snapshot replay is still the fallback when the gap is
 * too large to serve, and the daemon's own scrollback still bounds that path — hence both
 * assertions here: nothing older is lost, and the catch-up stays cheap. The spec logs the
 * measured cost so a later change is a decision with a number attached.
 */

type TrackedTerminal = NonNullable<Window["__byspaceTerminal"]>;

interface TerminalProbeWindow extends Window {
  __retainedTerminalInstances?: Set<TrackedTerminal>;
}

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
  });
}

async function readVisibleBufferText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const instances = Array.from(
      (window as TerminalProbeWindow).__retainedTerminalInstances ?? [],
    ) as {
      element?: HTMLElement;
      buffer: {
        active: {
          length: number;
          getLine: (index: number) => { translateToString: (trim: boolean) => string } | null;
        };
      };
    }[];
    const visible = instances.find((terminal) => terminal.element?.offsetParent !== null);
    if (!visible) {
      return "";
    }
    const buffer = visible.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  });
}

test.describe("terminal restore window", () => {
  let harness: TerminalE2EHarness;

  test.beforeEach(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-restore-window" });
  });

  test.afterEach(async () => {
    await harness.cleanup();
  });

  test("keeps every line the client already had after a workspace switch", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalProbe(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const otherRepo = await createTempGitRepo("terminal-restore-window-other");
    const otherWorkspace = await harness.client.createWorkspace({
      source: { kind: "directory", path: otherRepo.path },
    });
    const otherWorkspaceId = otherWorkspace.workspace?.id;
    if (!otherWorkspaceId) {
      throw new Error(otherWorkspace.error ?? "Failed to seed the second workspace");
    }

    const terminal = await harness.createTerminal({ name: "restore-window" });
    try {
      await harness.openTerminal(page, { terminalId: terminal.id });
      await waitForTerminalAttached(page);

      // 1500 lines overflow the daemon's own 1000-line scrollback: a snapshot replay could only
      // bring back around line-500, so anything older surviving the switch proves the client's
      // own buffer was kept instead of being reset.
      harness.client.sendTerminalInput(terminal.id, {
        type: "input",
        data: "seq 1 1500 | sed -e 's/^/line-/'\n",
      });
      await expect
        .poll(async () => await readVisibleBufferText(page), { timeout: 30_000 })
        .toContain("line-1500");
      await page.waitForTimeout(1_000);

      await selectWorkspaceInSidebar(page, otherWorkspaceId);
      await page.waitForTimeout(1_500);

      // Written while the pane is unsubscribed, so it can only reach the renderer through the
      // restore replay: seeing it is what proves the replay landed. The retained renderer still
      // shows the pre-switch buffer until then, which would otherwise satisfy any assertion
      // about the old content instantly.
      harness.client.sendTerminalInput(terminal.id, {
        type: "input",
        data: "echo hidden-marker\n",
      });
      await page.waitForTimeout(500);

      const startedAt = Date.now();
      await selectWorkspaceInSidebar(page, harness.workspaceId);
      await expect
        .poll(async () => await readVisibleBufferText(page), { timeout: 30_000 })
        .toContain("hidden-marker");
      const restoreMs = Date.now() - startedAt;
      const restored = await readVisibleBufferText(page);
      const restoredLines = [...restored.matchAll(/line-(\d+)/g)].map((match) =>
        Number(match[1] ?? 0),
      );
      const oldestRestored = Math.min(...restoredLines);
      console.log(
        "RESTORE_WINDOW",
        JSON.stringify({ restoreMs, oldestRestored, restoredChars: restored.length }),
      );

      // Resuming keeps the client's own scrollback, so the oldest line is the oldest the client
      // ever had — not the oldest the daemon still retains.
      expect(oldestRestored).toBe(1);
      // Only the gap crosses the wire, so coming back cannot get more expensive as the terminal
      // accumulates history. The snapshot replay of this same terminal measured 195ms.
      expect(restoreMs).toBeLessThan(150);
    } finally {
      await harness.killTerminal(terminal.id);
      await otherRepo.cleanup().catch(() => {});
    }
  });
});
