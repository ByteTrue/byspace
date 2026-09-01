import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { TerminalE2EHarness } from "../support/helpers/terminal-dsl";
import {
  getTerminalBufferText,
  waitForTerminalAttached,
  waitForTerminalContent,
} from "../support/helpers/terminal-perf";
import { selectWorkspaceInSidebar } from "../support/helpers/sidebar";
import { createTempGitRepo } from "../support/helpers/workspace";

interface TerminalRetentionProbeWindow extends Window {
  __retainedTerminalInstances?: Set<unknown>;
  __retainedTerminalResetWrites?: number;
  __retainedTerminalSetCount?: number;
  __retainedTerminalUnsetCount?: number;
}

async function installTerminalRetentionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as TerminalRetentionProbeWindow;
    const instances = new Set<unknown>();
    let current: unknown;
    let resetWrites = 0;
    let setCount = 0;
    let unsetCount = 0;
    win.__retainedTerminalInstances = instances;
    win.__retainedTerminalResetWrites = resetWrites;
    win.__retainedTerminalSetCount = setCount;
    win.__retainedTerminalUnsetCount = unsetCount;
    Object.defineProperty(win, "__paseoTerminal", {
      configurable: true,
      get: () => current,
      set: (terminal: unknown) => {
        current = terminal;
        if (!terminal) {
          unsetCount += 1;
          win.__retainedTerminalUnsetCount = unsetCount;
          return;
        }
        setCount += 1;
        win.__retainedTerminalSetCount = setCount;
        instances.add(terminal);
        const probeTerminal = terminal as {
          write?: (data: string | Uint8Array, callback?: () => void) => void;
          __retainedWriteWrapped?: boolean;
        };
        if (!probeTerminal.write || probeTerminal.__retainedWriteWrapped) {
          return;
        }
        const originalWrite = probeTerminal.write.bind(terminal);
        probeTerminal.write = (data, callback) => {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data);
          if (text.includes(String.fromCharCode(0x1b) + "c")) {
            resetWrites += 1;
            win.__retainedTerminalResetWrites = resetWrites;
          }
          originalWrite(data, callback);
        };
        probeTerminal.__retainedWriteWrapped = true;
      },
    });
  });
}

async function readTerminalRetentionState(page: Page): Promise<{
  instanceCount: number;
  text: string;
}> {
  return {
    instanceCount: await page.evaluate(
      () => (window as TerminalRetentionProbeWindow).__retainedTerminalInstances?.size ?? 0,
    ),
    text: await getTerminalBufferText(page),
  };
}

async function readTerminalRetentionProbe(page: Page): Promise<{
  resetWrites: number;
  setCount: number;
  unsetCount: number;
}> {
  return page.evaluate(() => {
    const win = window as TerminalRetentionProbeWindow;
    return {
      resetWrites: win.__retainedTerminalResetWrites ?? 0,
      setCount: win.__retainedTerminalSetCount ?? 0,
      unsetCount: win.__retainedTerminalUnsetCount ?? 0,
    };
  });
}

function outputSequenceNumbers(text: string): number[] {
  return [...text.matchAll(/OUT:(\d+):retained/g)].map((match) => Number(match[1] ?? 0));
}

test.describe("terminal restore window", () => {
  let harness: TerminalE2EHarness;

  test.beforeEach(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-restore-window" });
  });

  test.afterEach(async () => {
    await harness.cleanup();
  });

  test("keeps client history and applies hidden output after a workspace switch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await installTerminalRetentionProbe(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const otherRepo = await createTempGitRepo("terminal-restore-window-other");
    const otherWorkspace = await harness.client.createWorkspace({
      source: { kind: "directory", path: otherRepo.path },
    });
    const otherWorkspaceId = otherWorkspace.workspace?.id;
    if (!otherWorkspaceId) {
      throw new Error(otherWorkspace.error ?? "Failed to seed the second workspace");
    }

    const workloadPath = path.resolve(__dirname, "../fixtures/terminal-workload.mjs");
    const terminal = await harness.createTerminal({
      name: "restore-window",
      command: process.execPath,
      args: [
        workloadPath,
        "--count",
        "1500",
        "--interval-ms",
        "0",
        "--mode",
        "stream",
        "--token",
        "hidden-token",
        "--payload",
        "retained",
      ],
    });
    try {
      await harness.openTerminal(page, { terminalId: terminal.id });
      await waitForTerminalAttached(page);
      harness.client.sendTerminalInput(terminal.id, {
        type: "input",
        data: "GO\n",
      });
      await waitForTerminalContent(page, (text) => text.includes("WORKLOAD_DONE:1500:"), 30_000);
      const before = await readTerminalRetentionState(page);
      expect(before.instanceCount).toBeGreaterThan(0);
      expect(outputSequenceNumbers(before.text)).toContain(0);
      expect(outputSequenceNumbers(before.text)).toContain(1499);
      const probeBefore = await readTerminalRetentionProbe(page);
      await selectWorkspaceInSidebar(page, otherWorkspaceId);
      await page.waitForTimeout(500);
      harness.client.sendTerminalInput(terminal.id, {
        type: "input",
        data: "hidden-token:7:hidden-nonce\n",
      });
      await page.waitForTimeout(500);

      const startedAt = Date.now();
      await selectWorkspaceInSidebar(page, harness.workspaceId);
      await expect
        .poll(async () => (await readTerminalRetentionState(page)).text, { timeout: 30_000 })
        .toContain("ECHO:7:hidden-nonce");

      const restoreMs = Date.now() - startedAt;
      const after = await readTerminalRetentionState(page);
      const probeAfter = await readTerminalRetentionProbe(page);
      expect(after.instanceCount).toBe(before.instanceCount);
      expect(probeAfter).toEqual(probeBefore);
      const restoredSequenceNumbers = outputSequenceNumbers(after.text);
      expect(restoredSequenceNumbers).toContain(0);
      expect(restoredSequenceNumbers).toContain(1499);
      expect(after.text.match(/ECHO:7:hidden-nonce/g)).toHaveLength(1);
      console.log(
        "RESTORE_WINDOW",
        JSON.stringify({ restoreMs, restoredChars: after.text.length }),
      );

      await page.getByTestId("terminal-surface").first().click();
      await page
        .getByTestId("terminal-surface")
        .first()
        .pressSequentially("hidden-token:8:input-ready\n", { delay: 0 });
      await waitForTerminalContent(page, (text) => text.includes("ECHO:8:input-ready"), 10_000);
    } finally {
      await harness.killTerminal(terminal.id);
      await otherRepo.cleanup().catch(() => {});
    }
  });
});
