import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";
import { waitForTerminalContent } from "./helpers/terminal-perf";

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
        await terminal.press(shortcut);
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

  test("forces multiline text into one bracketed paste on Windows without reported mode state", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "Win32",
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => "first line\nsecond line",
          read: async () => [],
        },
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

      await terminal.press("Control+v");
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
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => "first line\nsecond line",
          read: async () => [],
        },
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

      await terminal.press("Control+v");
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
});
