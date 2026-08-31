import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { TerminalE2EHarness } from "../support/helpers/terminal-dsl";
import { waitForTerminalContent } from "../support/helpers/terminal-perf";

const CAPTURE_SCRIPT = `
const fs = require("node:fs");
let captured = Buffer.alloc(0);

function finish() {
  fs.writeFileSync(
    "clipboard-capture.json",
    JSON.stringify({ captured: captured.toString("base64") }),
  );
  process.stdout.write("\\x1b[?2004l\\r\\nBYSPACE_CLIPBOARD_CAPTURED\\r\\n");
  process.exit(0);
}

if (process.argv[2] !== "no-mode") {
  process.stdout.write("\\x1b[?2004h");
}
process.stdout.write("BYSPACE_CLIPBOARD_READY\\r\\n");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  captured = Buffer.concat([captured, chunk]);
  if (captured.includes(Buffer.from("\\x1b[201~"))) {
    finish();
  }
});
setTimeout(finish, 10_000);
`;

const MULTILINE_CLIPBOARD_TEXT = "first line\nsecond\x1bline";
const MULTILINE_CLIPBOARD_INPUT = "\x1b[200~first line\rsecond\u241bline\x1b[201~";
const PLAIN_MULTILINE_CLIPBOARD_TEXT = "first line\nsecond line";
const PLAIN_MULTILINE_CLIPBOARD_INPUT = "\x1b[200~first line\rsecond line\x1b[201~";

async function getTerminalPasteShortcut(page: Page): Promise<"Meta+v" | "Control+v"> {
  return page.evaluate(() =>
    /Macintosh|Mac OS/i.test(navigator.userAgent) ? "Meta+v" : "Control+v",
  );
}

async function readCapturedInput(harness: TerminalE2EHarness): Promise<string> {
  const capture = JSON.parse(
    await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
  ) as { captured: string };
  return Buffer.from(capture.captured, "base64").toString("utf8");
}

async function installWindowsClipboard(page: Page, text: string): Promise<void> {
  await page.addInitScript(
    ({ clipboardText }) => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Win32",
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => clipboardText,
        },
      });
    },
    { clipboardText: text },
  );
}

async function waitForCapture(page: Page): Promise<void> {
  await waitForTerminalContent(page, (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"), 10_000);
}

test.describe("Terminal text clipboard", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-clipboard-" });
    await writeFile(path.join(harness.tempRepo.path, "clipboard-capture.cjs"), CAPTURE_SCRIPT);
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("captures one framed Windows multiline Ctrl+V without reported mode state", async ({
    page,
  }) => {
    await installWindowsClipboard(page, MULTILINE_CLIPBOARD_TEXT);

    const terminalInstance = await harness.createTerminal({ name: "clipboard-text-windows" });
    try {
      await harness.openTerminal(page, { terminalId: terminalInstance.id });
      await harness.setupPrompt(page);
      const terminal = harness.terminalSurface(page);
      await terminal.pressSequentially("node clipboard-capture.cjs no-mode\n", { delay: 0 });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_READY"),
        10_000,
      );
      await page.waitForFunction(() => window.__paseoTerminal?.modes.bracketedPasteMode === false);

      await terminal.press(await getTerminalPasteShortcut(page));
      await waitForCapture(page);

      await expect.poll(() => readCapturedInput(harness)).toBe(MULTILINE_CLIPBOARD_INPUT);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("captures framed multiline text after mode replay on page reload", async ({ page }) => {
    await installWindowsClipboard(page, PLAIN_MULTILINE_CLIPBOARD_TEXT);

    const terminalInstance = await harness.createTerminal({ name: "clipboard-text-snapshot" });
    try {
      await harness.openTerminal(page, { terminalId: terminalInstance.id });
      await harness.setupPrompt(page);
      let terminal = harness.terminalSurface(page);
      await terminal.pressSequentially("node clipboard-capture.cjs\n", { delay: 0 });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_READY"),
        10_000,
      );

      await page.reload();
      terminal = harness.terminalSurface(page);
      await terminal.waitFor({ state: "visible" });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_READY"),
        10_000,
      );
      await page.waitForFunction(() => window.__paseoTerminal?.modes.bracketedPasteMode === true);

      await terminal.press(await getTerminalPasteShortcut(page));
      await waitForCapture(page);

      await expect.poll(() => readCapturedInput(harness)).toBe(PLAIN_MULTILINE_CLIPBOARD_INPUT);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });
});
