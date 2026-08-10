import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { buildTerminalWorkspaceUrl, waitForTerminalContent } from "./helpers/terminal-perf";

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

function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("Terminal clipboard", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-clipboard-" });
    await writeFile(path.join(harness.tempRepo.path, "clipboard-capture.cjs"), CAPTURE_SCRIPT);
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  for (const { label, shortcut } of [
    { label: "Ctrl+V", shortcut: "Control+v" },
    { label: "Alt+V", shortcut: "Alt+v" },
  ]) {
    test(`uploads a clipboard image with ${label} and pastes one bracketed path`, async ({
      page,
    }) => {
      if (label === "Alt+V") {
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
                readText: async () => "",
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

      const terminalInstance = await harness.createTerminal({ name: `clipboard-image-${label}` });
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
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __byspaceTerminal?: { modes?: { bracketedPasteMode?: boolean } };
                }
              ).__byspaceTerminal?.modes?.bracketedPasteMode,
          ),
        ).toBe(false);
        if (label === "Ctrl+V") {
          await dispatchTerminalPaste(terminal, {
            image: { bytes: IMAGE_BYTES, name: "clipboard.png", type: "image/png" },
          });
        } else {
          await terminal.press(shortcut);
        }
        await waitForTerminalContent(
          page,
          (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"),
          10_000,
        );

        const capture = JSON.parse(
          await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
        ) as { captured: string };
        const input = Buffer.from(capture.captured, "base64").toString("utf8");
        expect(input.startsWith("\x1b[200~")).toBe(true);
        expect(input.endsWith("\x1b[201~")).toBe(true);

        const uploadedPath = input.slice("\x1b[200~".length, -"\x1b[201~".length);
        expect([...(await readFile(uploadedPath))]).toEqual(IMAGE_BYTES);
      } finally {
        await harness.killTerminal(terminalInstance.id);
      }
    });
  }

  test("uploads an image over text from the same paste event", async ({ page }) => {
    const pixPinPath = "/Users/byte/Library/Application Support/PixPin/Temp/PixPin_capture.jpg";
    const terminalInstance = await harness.createTerminal({
      name: "clipboard-text-and-image",
    });
    try {
      await harness.openTerminal(page, { terminalId: terminalInstance.id });
      await harness.setupPrompt(page);

      const terminal = harness.terminalSurface(page);
      await terminal.pressSequentially("node clipboard-capture.cjs\n", { delay: 0 });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_READY"),
        10_000,
      );

      await dispatchTerminalPaste(terminal, {
        text: pixPinPath,
        image: { bytes: IMAGE_BYTES, name: "clipboard.png", type: "image/png" },
      });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"),
        10_000,
      );

      const capture = JSON.parse(
        await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
      ) as { captured: string };
      const input = Buffer.from(capture.captured, "base64").toString("utf8");
      const uploadedPath = input.slice("\x1b[200~".length, -"\x1b[201~".length);
      expect(input).toBe(`\x1b[200~${uploadedPath}\x1b[201~`);
      expect(uploadedPath).not.toBe(pixPinPath);
      expect(uploadedPath).toContain(`${path.sep}uploads${path.sep}`);
      expect([...(await readFile(uploadedPath)).subarray(0, IMAGE_BYTES.length)]).toEqual(
        IMAGE_BYTES,
      );
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("forces multiline text into one bracketed paste on Windows without reported mode state", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Win32",
      });
    });

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
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __byspaceTerminal?: { modes?: { bracketedPasteMode?: boolean } };
            }
          ).__byspaceTerminal?.modes?.bracketedPasteMode === false,
      );

      await dispatchTerminalPaste(terminal, { text: "first line\nsecond line" });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"),
        10_000,
      );

      const capture = JSON.parse(
        await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
      ) as { captured: string };
      expect(Buffer.from(capture.captured, "base64").toString("utf8")).toBe(
        "\x1b[200~first line\rsecond line\x1b[201~",
      );
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("restores bracketed paste after a snapshot before multiline text paste", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Win32",
      });
    });

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
      await page.waitForFunction(
        () =>
          (
            window as Window & {
              __byspaceTerminal?: { modes?: { bracketedPasteMode?: boolean } };
            }
          ).__byspaceTerminal?.modes?.bracketedPasteMode === true,
      );

      await dispatchTerminalPaste(terminal, { text: "first line\nsecond line" });
      await waitForTerminalContent(
        page,
        (text) => text.includes("BYSPACE_CLIPBOARD_CAPTURED"),
        10_000,
      );

      const capture = JSON.parse(
        await readFile(path.join(harness.tempRepo.path, "clipboard-capture.json"), "utf8"),
      ) as { captured: string };
      expect(Buffer.from(capture.captured, "base64").toString("utf8")).toBe(
        "\x1b[200~first line\rsecond line\x1b[201~",
      );
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });

  test("copies text selected by long-press on a compact terminal", async ({ context, page }) => {
    const target = "MOBILE COPY TARGET";
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    });
    const terminalInstance = await harness.createTerminal({ name: "clipboard-mobile-copy" });

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(buildTerminalWorkspaceUrl(harness.workspaceId, terminalInstance.id));

      const terminal = harness.terminalSurface(page);
      await terminal.waitFor({ state: "visible", timeout: 30_000 });
      await page
        .getByTestId("terminal-attach-loading")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});
      await terminal.click();
      await harness.setupPrompt(page);
      await terminal.pressSequentially(`printf '\\033[?1000h${target}\\n'\n`, { delay: 0 });
      await waitForTerminalContent(page, (text) => text.includes(target), 10_000);

      const coordinates = await terminal
        .locator(".xterm-screen")
        .evaluate((screen, selectedText) => {
          const browserTerminal = (
            window as Window & {
              __byspaceTerminal?: {
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
          ).__byspaceTerminal;
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
          };
        }, target);

      const terminalUrl = page.url();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
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
      await cdp.detach();

      const copyButton = page.getByTestId("terminal-copy-selection");
      await expect(copyButton).toBeVisible();
      await expect(terminal).toBeVisible();
      expect(page.url()).toBe(terminalUrl);
      await copyButton.click();
      await expect.poll(() => readClipboard(page)).toBe(target);
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });
});
