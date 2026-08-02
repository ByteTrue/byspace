import { test, expect, type Page } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { waitForTerminalAttached } from "./helpers/terminal-perf";

/**
 * Regression: a refit that lands on a passive path must still reach the PTY once this client
 * owns the size.
 *
 * Passive refits (`shouldClaim: false`) are the post-mount fit ladder, font metrics settling,
 * the WebGL renderer swap with its own cell dimensions, and window visibility restore. They
 * were measured but never sent, so the renderer could sit at a width the daemon never learned:
 * the app kept painting the old, narrower screen and left a blank strip on the right until the
 * user clicked into the pane and re-claimed.
 *
 * The repro stages the visibility-restore variant, which is the only passive path Playwright
 * can drive deterministically: blur the window, resize it (the resize claim is dropped while
 * the app is not actively visible), then focus it again.
 */

type TrackedTerminal = NonNullable<Window["__byspaceTerminal"]>;

interface TerminalProbeWindow extends Window {
  __retainedTerminalInstances?: Set<TrackedTerminal>;
}

// A minimal alternate-screen TUI: it repaints a full-width ruler on every SIGWINCH, exactly
// like an agent CLI does. The ruler is what the user sees, so it is what the test asserts on.
const TUI_SCRIPT = `
process.stdout.write("\\x1b[?1049h");
const draw = () => {
  process.stdout.write("\\x1b[2J\\x1b[H" + "-".repeat(process.stdout.columns));
};
process.stdout.on("resize", draw);
draw();
setInterval(() => {}, 1000);
`;

/**
 * Simulates the window losing/regaining OS focus, which is what `useAppVisible` reads through
 * `document.hasFocus()` plus the window focus/blur events. Headless Chromium never really
 * blurs, so the environment signal has to be stubbed; every code path under test stays real.
 */
async function setWindowFocused(page: Page, focused: boolean): Promise<void> {
  await page.evaluate((isFocused) => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => isFocused,
    });
    window.dispatchEvent(new Event(isFocused ? "focus" : "blur"));
  }, focused);
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

async function readVisibleTerminal(page: Page): Promise<{ cols: number; ruler: number }> {
  return await page.evaluate(() => {
    const instances = Array.from(
      (window as TerminalProbeWindow).__retainedTerminalInstances ?? [],
    ) as {
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
    if (!visible) {
      return { cols: -1, ruler: -1 };
    }
    const buffer = visible.buffer.active;
    let ruler = -1;
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index)?.translateToString(true).trimEnd() ?? "";
      if (/^-{10,}$/.test(line)) {
        ruler = line.length;
      }
    }
    return { cols: visible.cols, ruler };
  });
}

test.describe("terminal passive refit", () => {
  let harness: TerminalE2EHarness;

  test.beforeEach(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-passive-refit" });
  });

  test.afterEach(async () => {
    await harness.cleanup();
  });

  test("a refit after visibility restore reaches the PTY without a click", async ({ page }) => {
    test.setTimeout(120_000);
    await installTerminalProbe(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const terminal = await harness.createTerminal({
      name: "passive-refit-tui",
      command: "node",
      args: ["-e", TUI_SCRIPT],
    });
    try {
      await harness.openTerminal(page, { terminalId: terminal.id });
      await waitForTerminalAttached(page);
      await expect
        .poll(
          async () => {
            const { cols, ruler } = await readVisibleTerminal(page);
            return `${ruler}/${cols}`;
          },
          { timeout: 20_000 },
        )
        .toMatch(/^(\d+)\/\1$/);
      const colsBefore = (await readVisibleTerminal(page)).cols;

      // The window loses focus, so any resize claim measured from here on is dropped...
      await setWindowFocused(page, false);
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(1_500);

      // ...and comes back, which refits on the passive visibility-restore path.
      await setWindowFocused(page, true);

      // The TUI must repaint at the new width on its own: the pane never got a click.
      await expect
        .poll(
          async () => {
            const { cols, ruler } = await readVisibleTerminal(page);
            return `${ruler}/${cols}`;
          },
          { timeout: 15_000 },
        )
        .toMatch(/^(\d+)\/\1$/);

      // Sanity: the wider viewport really moved the renderer, so the assertion above is not
      // passing on the pre-resize geometry.
      expect((await readVisibleTerminal(page)).cols).toBeGreaterThan(colsBefore);
    } finally {
      await harness.killTerminal(terminal.id);
    }
  });
});
