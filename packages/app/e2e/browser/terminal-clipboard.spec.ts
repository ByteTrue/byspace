import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
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

const IMAGE_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];
const MULTILINE_CLIPBOARD_TEXT = "first line\nsecond\x1bline";
const MULTILINE_CLIPBOARD_INPUT = "\x1b[200~first line\rsecond\u241bline\x1b[201~";
const PLAIN_MULTILINE_CLIPBOARD_TEXT = "first line\nsecond line";
const PLAIN_MULTILINE_CLIPBOARD_INPUT = "\x1b[200~first line\rsecond line\x1b[201~";
const COMPACT_SELECTION_TARGET = "MOBILE COPY TARGET";
const COMPACT_SELECTION_SCRIPT = `
for (let index = 1; index <= 50; index += 1) {
  process.stdout.write(\`scroll-\${index}\\n\`);
}
process.stdout.write("\\x1b[?1000h${COMPACT_SELECTION_TARGET}\\n");
`;
const COMPACT_CLICK_INPUT_SCRIPT = `process.stdout.write("CLICK_INPUT_MARKER\\n");\n`;

async function dispatchTerminalPaste(
  terminal: Locator,
  clipboard: {
    text?: string;
    image?: { bytes: number[]; name: string; type: string };
  },
): Promise<void> {
  await terminal.locator("textarea").evaluate((textarea, { text, image }) => {
    const clipboardData = new DataTransfer();
    if (text !== undefined) {
      clipboardData.setData("text/plain", text);
    }
    if (image) {
      clipboardData.items.add(
        new File([Uint8Array.from(image.bytes)], image.name, { type: image.type }),
      );
    }
    textarea.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  }, clipboard);
}

async function readCapturedInput(harness: TerminalE2EHarness): Promise<string> {
  const capture = JSON.parse(
    await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
  ) as { captured: string };
  return Buffer.from(capture.captured, "base64").toString("utf8");
}

async function installWindowsPlatform(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });
  });
}

async function waitForCapture(page: Page): Promise<void> {
  await waitForTerminalContent(page, (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"), 10_000);
}

function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

function readTerminalViewportY(page: Page): Promise<number> {
  return page.evaluate(() => window.__paseoTerminal?.buffer.active.viewportY ?? 0);
}

test.describe("Terminal clipboard", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-clipboard-" });
    await writeFile(path.join(harness.tempRepo.path, "clipboard-capture.cjs"), CAPTURE_SCRIPT);
    await writeFile(
      path.join(harness.tempRepo.path, "clipboard-selection-output.cjs"),
      COMPACT_SELECTION_SCRIPT,
    );
    await writeFile(
      path.join(harness.tempRepo.path, "clipboard-click-input.cjs"),
      COMPACT_CLICK_INPUT_SCRIPT,
    );
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  for (const trigger of ["paste-event", "windows-alt-v"] as const) {
    test(`uploads a clipboard image through ${trigger} and pastes one bracketed daemon path`, async ({
      page,
    }) => {
      if (trigger === "windows-alt-v") {
        await page.addInitScript(
          ({ bytes }) => {
            const imageBytes = Uint8Array.from(bytes);
            Object.defineProperty(navigator, "platform", {
              configurable: true,
              value: "Win32",
            });
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: {
                read: async () => [
                  {
                    types: ["image/png"],
                    getType: async () => new Blob([imageBytes], { type: "image/png" }),
                  },
                ],
              },
            });
          },
          { bytes: IMAGE_BYTES },
        );
      }

      const terminalInstance = await harness.createTerminal({ name: `clipboard-${trigger}` });
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
        await page.waitForFunction(
          () => window.__paseoTerminal?.modes.bracketedPasteMode === false,
        );

        if (trigger === "paste-event") {
          await dispatchTerminalPaste(terminal, {
            image: { bytes: IMAGE_BYTES, name: "clipboard.png", type: "image/png" },
          });
        } else {
          await terminal.press("Alt+v");
        }
        await waitForCapture(page);

        const input = await readCapturedInput(harness);
        expect(input.startsWith("\x1b[200~")).toBe(true);
        expect(input.endsWith("\x1b[201~")).toBe(true);
        const uploadedPath = input.slice("\x1b[200~".length, -"\x1b[201~".length);
        expect(uploadedPath).toContain(`${path.sep}uploads${path.sep}`);
        expect([...(await readFile(uploadedPath))]).toEqual(IMAGE_BYTES);
      } finally {
        await harness.killTerminal(terminalInstance.id);
      }
    });
  }

  test("prefers a clipboard image over text from the same paste event", async ({ page }) => {
    const clipboardText = "/Users/example/PixPin/capture.jpg";
    const terminalInstance = await harness.createTerminal({ name: "clipboard-text-image" });
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

      await dispatchTerminalPaste(terminal, {
        text: clipboardText,
        image: { bytes: IMAGE_BYTES, name: "clipboard.png", type: "image/png" },
      });
      await waitForCapture(page);

      const input = await readCapturedInput(harness);
      const uploadedPath = input.slice("\x1b[200~".length, -"\x1b[201~".length);
      expect(input).toBe(`\x1b[200~${uploadedPath}\x1b[201~`);
      expect(uploadedPath).not.toBe(clipboardText);
      expect(uploadedPath).toContain(`${path.sep}uploads${path.sep}`);
      expect([...(await readFile(uploadedPath))]).toEqual(IMAGE_BYTES);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("captures one framed Windows multiline paste without reported mode state", async ({
    page,
  }) => {
    await installWindowsPlatform(page);

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

      await dispatchTerminalPaste(terminal, { text: MULTILINE_CLIPBOARD_TEXT });
      await waitForCapture(page);

      await expect.poll(() => readCapturedInput(harness)).toBe(MULTILINE_CLIPBOARD_INPUT);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("captures framed multiline text after mode replay on page reload", async ({ page }) => {
    await installWindowsPlatform(page);

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

      await dispatchTerminalPaste(terminal, { text: PLAIN_MULTILINE_CLIPBOARD_TEXT });
      await waitForCapture(page);

      await expect.poll(() => readCapturedInput(harness)).toBe(PLAIN_MULTILINE_CLIPBOARD_INPUT);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("copies text selected by long-press on a compact terminal", async ({ context, page }) => {
    const target = COMPACT_SELECTION_TARGET;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const terminalInstance = await harness.createTerminal({ name: "clipboard-mobile-copy" });

    try {
      await harness.openTerminal(page, { terminalId: terminalInstance.id });
      await page.setViewportSize({ width: 390, height: 844 });

      const terminal = harness.terminalSurface(page);
      await terminal.waitFor({ state: "visible", timeout: 30_000 });
      await page
        .getByTestId("terminal-attach-loading")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
      await terminal.click();
      await harness.setupPrompt(page);
      await terminal.pressSequentially("node clipboard-selection-output.cjs\n", { delay: 0 });
      await waitForTerminalContent(page, (text) => text.includes(target), 10_000);

      const coordinates = await terminal
        .locator(".xterm-screen")
        .evaluate((screen, selectedText) => {
          const browserTerminal = (
            window as Window & {
              __paseoTerminal?: {
                dimensions?: { css: { cell: { width: number; height: number } } };
                buffer: {
                  active: {
                    length: number;
                    viewportY: number;
                    getLine: (
                      row: number,
                    ) => { translateToString: (trimRight: boolean) => string } | undefined;
                  };
                };
              };
            }
          ).__paseoTerminal;
          const cell = browserTerminal?.dimensions?.css.cell;
          if (!browserTerminal || !cell) {
            throw new Error("Terminal dimensions are unavailable");
          }

          const buffer = browserTerminal.buffer.active;
          let targetRow = -1;
          let targetColumn = -1;
          for (let row = buffer.viewportY; row < buffer.length; row += 1) {
            const column = buffer.getLine(row)?.translateToString(true).indexOf(selectedText) ?? -1;
            if (column >= 0) {
              targetRow = row;
              targetColumn = column;
            }
          }
          if (targetRow < buffer.viewportY || targetColumn < 0) {
            throw new Error("Expected copy target to be visible in terminal buffer");
          }

          const bounds = screen.getBoundingClientRect();
          return {
            startX: bounds.left + (targetColumn + 0.5) * cell.width,
            endX: bounds.left + (targetColumn + selectedText.length - 0.5) * cell.width,
            y: bounds.top + (targetRow - buffer.viewportY + 0.5) * cell.height,
            scrollX: bounds.left + cell.width,
            scrollY: bounds.top + cell.height / 2,
            scrollDistance: cell.height * 5,
          };
        }, target);

      const terminalUrl = page.url();
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 1,
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: coordinates.startX, y: coordinates.y }],
        });
        await page.waitForTimeout(600);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: coordinates.endX, y: coordinates.y }],
        });
        await page.waitForTimeout(50);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

        const copyButton = page.getByTestId("terminal-copy");
        await expect(copyButton).toBeVisible();
        await expect(terminal).toBeVisible();
        expect(page.url()).toBe(terminalUrl);
        await copyButton.click();
        await expect.poll(() => readClipboard(page)).toBe(target);

        await terminal.click();
        await terminal.pressSequentially("node clipboard-click-input.cjs\n", { delay: 0 });
        await waitForTerminalContent(page, (text) => text.includes("CLICK_INPUT_MARKER"), 10_000);

        const viewportBefore = await readTerminalViewportY(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: coordinates.scrollX, y: coordinates.scrollY }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: coordinates.scrollX,
              y: coordinates.scrollY + coordinates.scrollDistance,
            },
          ],
        });
        await page.waitForTimeout(50);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => readTerminalViewportY(page)).not.toBe(viewportBefore);
      } finally {
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
        await cdp.detach();
      }
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });
});
