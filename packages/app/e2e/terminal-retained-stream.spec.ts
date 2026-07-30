import { test, expect, type Page } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { waitForTerminalAttached } from "./helpers/terminal-perf";

interface TerminalSubscriptionProbeWindow extends Window {
  __activeTerminalSubscriptions?: Set<string>;
}

test.describe("retained terminal stream visibility", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "retained-terminal-stream-" });
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("only subscribes the visible terminal and restores output missed while hidden", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSubscriptionProbe(page);
    const first = await harness.createTerminal({ name: "first" });
    const second = await harness.createTerminal({ name: "second" });

    try {
      await harness.openTerminal(page, { terminalId: first.id });
      await harness.openTerminal(page, { terminalId: second.id });

      const firstTab = page.getByTestId(`workspace-tab-terminal_${first.id}`).first();
      const secondTab = page.getByTestId(`workspace-tab-terminal_${second.id}`).first();
      await expect(firstTab).toBeVisible();
      await expect(secondTab).toBeVisible();
      await expect.poll(() => readActiveTerminalSubscriptions(page)).toEqual([second.id]);

      await firstTab.click();
      await waitForTerminalAttached(page);
      await expect.poll(() => readActiveTerminalSubscriptions(page)).toEqual([first.id]);

      const sentinel = `HIDDEN_OUTPUT_${Date.now()}`;
      harness.client.sendTerminalInput(second.id, {
        type: "input",
        data: `echo ${sentinel}\r`,
      });
      await expect
        .poll(async () => {
          const capture = await (
            harness.client as typeof harness.client & {
              captureTerminal: (terminalId: string) => Promise<{ lines: string[] }>;
            }
          ).captureTerminal(second.id);
          return capture.lines.join("\n");
        })
        .toContain(sentinel);

      await secondTab.click();
      await waitForTerminalAttached(page);
      await expect.poll(() => readActiveTerminalSubscriptions(page)).toEqual([second.id]);
      await expect(
        page.locator('[data-testid="terminal-surface"]:visible .xterm-rows'),
      ).toContainText(sentinel, { timeout: 10_000 });

      await page.getByRole("button", { name: "Split pane right" }).first().click();
      await expect(page.getByRole("button", { name: "Split pane right" })).toHaveCount(2);
      await waitForAnimationFrame(page);
      await waitForAnimationFrame(page);
      await expect.poll(() => readActiveTerminalSubscriptions(page)).toEqual([second.id]);
    } finally {
      await harness.killTerminal(first.id);
      await harness.killTerminal(second.id);
    }
  });
});

async function waitForAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

async function installSubscriptionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as TerminalSubscriptionProbeWindow;
    const activeTerminalSubscriptions = new Set<string>();
    win.__activeTerminalSubscriptions = activeTerminalSubscriptions;
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const envelope = JSON.parse(data) as {
            type?: string;
            message?: { type?: string; terminalId?: string };
          };
          const message = envelope.message;
          if (envelope.type === "session" && message?.terminalId) {
            if (message.type === "subscribe_terminal_request") {
              activeTerminalSubscriptions.add(message.terminalId);
            } else if (message.type === "unsubscribe_terminal_request") {
              activeTerminalSubscriptions.delete(message.terminalId);
            }
          }
        } catch {
          // Non-JSON frames are unrelated to terminal subscription ownership.
        }
      }
      originalSend.call(this, data);
    };
  });
}

async function readActiveTerminalSubscriptions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...((window as TerminalSubscriptionProbeWindow).__activeTerminalSubscriptions ??
        new Set<string>()),
    ].sort(),
  );
}
