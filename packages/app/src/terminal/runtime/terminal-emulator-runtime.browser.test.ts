import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TerminalInputModeTracker,
  type TerminalInputModeState,
} from "@bytetrue/byspace-protocol/terminal-input-mode";
import {
  encodeTerminalOutput,
  TerminalEmulatorRuntime,
  type TerminalEmulatorRuntimeCallbacks,
} from "./terminal-emulator-runtime";

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon {
    activate(): void {}
    dispose(): void {}
    onContextLoss(): void {}
  },
}));

interface TerminalSize {
  rows: number;
  cols: number;
  shouldClaim: boolean;
}

interface TerminalKeyRecord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

type BrowserTerminal = TerminalSize & {
  refresh: (start: number, end: number) => void;
  reset: () => void;
  paste: (text: string) => void;
};

interface MountedTerminal {
  host: HTMLDivElement;
  root: HTMLDivElement;
  runtime: TerminalEmulatorRuntime;
  inputs: string[];
  sizes: TerminalSize[];
  terminalKeys: TerminalKeyRecord[];
  inputModeChanges: TerminalInputModeState[];
  pasteErrors: string[];
}

const mountedTerminals: MountedTerminal[] = [];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function terminalOutput(text: string): Uint8Array {
  return encodeTerminalOutput(text);
}

async function waitFor(input: { predicate: () => boolean; timeoutMs?: number }): Promise<void> {
  const startedAt = performance.now();
  const timeoutMs = input.timeoutMs ?? 2_000;

  while (!input.predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for terminal browser condition");
    }
    await nextFrame();
  }
}

function settleMountRefits(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2_600));
}

function createTerminalHost(input: {
  width: number;
  height: number;
  scrollback?: number;
  callbacks?: TerminalEmulatorRuntimeCallbacks;
}): MountedTerminal {
  const root = document.createElement("div");
  root.style.width = `${input.width}px`;
  root.style.height = `${input.height}px`;
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.overflow = "hidden";

  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  root.appendChild(host);
  document.body.appendChild(root);

  const sizes: TerminalSize[] = [];
  const inputs: string[] = [];
  const terminalKeys: TerminalKeyRecord[] = [];
  const inputModeChanges: TerminalInputModeState[] = [];
  const pasteErrors: string[] = [];
  const runtime = new TerminalEmulatorRuntime();
  runtime.setCallbacks({
    callbacks: {
      onInput: (data) => {
        inputs.push(data);
      },
      onResize: (size) => {
        sizes.push(size);
      },
      onTerminalKey: (key) => {
        terminalKeys.push(key);
      },
      onInputModeChange: (state) => {
        inputModeChanges.push(state);
      },
      onPasteError: (reason) => {
        pasteErrors.push(reason);
      },
      ...input.callbacks,
    },
  });
  runtime.mount({
    root,
    host,
    initialSnapshot: null,
    scrollback: input.scrollback ?? 10_000,
    theme: {
      background: "#0b0b0b",
      foreground: "#e6e6e6",
      cursor: "#e6e6e6",
    },
  });

  const mounted = {
    host,
    root,
    runtime,
    inputs,
    sizes,
    terminalKeys,
    inputModeChanges,
    pasteErrors,
  };
  mountedTerminals.push(mounted);
  return mounted;
}

function latestSize(sizes: TerminalSize[]): TerminalSize {
  const size = sizes.at(-1);
  if (!size) {
    throw new Error("Terminal did not report a size");
  }
  return size;
}

function getBrowserTerminal(): BrowserTerminal {
  const terminal = window.__byspaceTerminal as BrowserTerminal | undefined;
  if (!terminal) {
    throw new Error("Expected xterm to be exposed for browser test inspection");
  }
  return terminal;
}

function dispatchTerminalKey(input: {
  host: HTMLElement;
  key: string;
  code?: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): boolean {
  const textarea = input.host.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Expected xterm textarea to be mounted");
  }
  textarea.focus();
  const event = new KeyboardEvent("keydown", {
    key: input.key,
    code: input.code ?? "",
    shiftKey: input.shiftKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    altKey: input.altKey ?? false,
    metaKey: input.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (input.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: input.keyCode });
  }
  return textarea.dispatchEvent(event);
}

function setNavigatorPlatform(platform: string): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, "platform", descriptor);
    } else {
      Reflect.deleteProperty(navigator, "platform");
    }
  };
}

afterEach(() => {
  for (const mounted of mountedTerminals.splice(0)) {
    mounted.runtime.unmount();
    mounted.root.remove();
  }
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("terminal emulator runtime in a real browser", () => {
  it("passes configured scrollback to xterm", async () => {
    await page.viewport(900, 600);
    createTerminalHost({ width: 720, height: 360, scrollback: 42_000 });

    await waitFor({
      predicate: () => window.__byspaceTerminal !== undefined,
    });

    expect(window.__byspaceTerminal?.options.scrollback).toBe(42_000);
  });

  it("updates scrollback on the mounted xterm", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360, scrollback: 10_000 });

    await waitFor({
      predicate: () => window.__byspaceTerminal !== undefined,
    });
    const terminal = window.__byspaceTerminal;

    mounted.runtime.setScrollback({ lines: 42_000 });

    expect(window.__byspaceTerminal).toBe(terminal);
    expect(window.__byspaceTerminal?.options.scrollback).toBe(42_000);
  });

  it("does not claim PTY ownership from passive mount refits", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();

    expect(mounted.sizes.length).toBeGreaterThan(1);
    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);

    const settledSize = latestSize(mounted.sizes);
    mounted.runtime.resize({ force: true, shouldClaim: true });

    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([
      { ...settledSize, shouldClaim: true },
    ]);
  });

  it("reports a larger PTY size when the terminal container grows", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 360, height: 180 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const initialSize = latestSize(mounted.sizes);

    mounted.root.style.width = "720px";
    mounted.root.style.height = "360px";
    await nextFrame();
    mounted.runtime.resize({ force: true });

    await waitFor({
      predicate: () => {
        const size = latestSize(mounted.sizes);
        return size.cols > initialSize.cols && size.rows > initialSize.rows;
      },
    });

    const grownSize = latestSize(mounted.sizes);
    expect(grownSize.cols).toBeGreaterThan(initialSize.cols);
    expect(grownSize.rows).toBeGreaterThan(initialSize.rows);
    expect(grownSize.shouldClaim).toBe(true);
  });

  it("refreshes visible rows on a forced same-size resize", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    const terminal = getBrowserTerminal();
    const refreshCalls: Array<[number, number]> = [];
    const originalRefresh = terminal.refresh.bind(terminal);
    terminal.refresh = (start, end) => {
      refreshCalls.push([start, end]);
      originalRefresh(start, end);
    };

    mounted.runtime.resize({ force: true });

    await waitFor({ predicate: () => refreshCalls.length > 0 });
    expect(refreshCalls.at(-1)).toEqual([0, terminal.rows - 1]);
  });

  it("intercepts Shift+Enter only after enhanced terminal input mode is active", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([]);

    mounted.runtime.write({ data: terminalOutput("\x1b[>7u") });
    await waitFor({
      predicate: () =>
        mounted.inputModeChanges.some(
          (state) => state.kittyKeyboardFlags === 7 && !state.win32InputMode,
        ),
    });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([
      {
        key: "Enter",
        ctrl: false,
        shift: true,
        alt: false,
        meta: false,
      },
    ]);

    mounted.terminalKeys.length = 0;
    mounted.runtime.write({ data: terminalOutput("\x1b[=0;0u\x1b[?9001h") });
    await waitFor({
      predicate: () =>
        mounted.inputModeChanges.some(
          (state) => state.kittyKeyboardFlags === 0 && state.win32InputMode,
        ),
    });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([
      {
        key: "Enter",
        ctrl: false,
        shift: true,
        alt: false,
        meta: false,
      },
    ]);
  });

  it("forwards Alt+V to the terminal application", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalKey({ host: mounted.host, key: "v", code: "KeyV", keyCode: 86, altKey: true });

    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual(["\x1bv"]);
  });

  it("preserves bracketed paste mode when replaying a snapshot", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const terminal = getBrowserTerminal();
    const paste = "first line\nsecond line";
    const bracketedPaste = "\x1b[200~first line\rsecond line\x1b[201~";
    const authoritativeInputMode = new TerminalInputModeTracker();
    authoritativeInputMode.feed("\x1b[?2004h");

    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("\x1b[?2004h"), onCommitted: resolve });
    });
    terminal.paste(paste);
    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual([bracketedPaste]);

    mounted.inputs.length = 0;
    await new Promise<void>((resolve) => {
      mounted.runtime.renderSnapshot({
        state: {
          rows: terminal.rows,
          cols: terminal.cols,
          scrollback: [],
          grid: [[{ char: ">" }]],
          cursor: { row: 0, col: 1 },
        },
        onCommitted: resolve,
      });
    });
    await new Promise<void>((resolve) => {
      mounted.runtime.write({
        data: terminalOutput(authoritativeInputMode.getPreamble()),
        onCommitted: resolve,
      });
    });

    terminal.paste(paste);
    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual([bracketedPaste]);
  });

  it("uploads a clipboard image and pastes the daemon path as one bracketed block", async () => {
    await page.viewport(900, 600);
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const pastedImages: Array<{
      bytes: Uint8Array;
      mimeType: string;
      fileExtension: string;
    }> = [];
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: {
        onPasteImage: async (image) => {
          pastedImages.push(image);
          return "/tmp/clipboard-image.png";
        },
      },
    });
    const read = vi.fn(async () => [
      {
        types: ["image/png"],
        getType: async () => new Blob([imageBytes], { type: "image/png" }),
        presentationStyle: "unspecified" as const,
      } satisfies ClipboardItem,
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        read,
      },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("\x1b[?2004h"), onCommitted: resolve });
    });
    dispatchTerminalKey({
      host: mounted.host,
      key: "v",
      code: "KeyV",
      keyCode: 86,
      ...(navigator.platform.includes("Mac") ? { metaKey: true } : { ctrlKey: true }),
    });

    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(pastedImages).toEqual([
      {
        bytes: imageBytes,
        mimeType: "image/png",
        fileExtension: "png",
      },
    ]);
    expect(mounted.inputs).toEqual(["\x1b[200~/tmp/clipboard-image.png\x1b[201~"]);
  });

  it("uses the browser clipboard image for Pi's Windows Alt+V shortcut", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const onPasteImage = vi.fn(async () => "/tmp/windows-clipboard.png");
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          read: vi.fn(async () => [
            {
              types: ["image/png"],
              getType: async () => new Blob([new Uint8Array([137, 80, 78, 71])]),
              presentationStyle: "unspecified" as const,
            } satisfies ClipboardItem,
          ]),
        },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", code: "KeyV", altKey: true });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(onPasteImage).toHaveBeenCalledTimes(1);
      expect(mounted.inputs).toEqual(["/tmp/windows-clipboard.png"]);
      expect(mounted.terminalKeys).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("forwards Windows Alt+V when the browser clipboard has no image", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: vi.fn(async () => null) },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: vi.fn(async () => []) },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", code: "KeyV", altKey: true });

      await waitFor({ predicate: () => mounted.terminalKeys.length === 1 });
      expect(mounted.terminalKeys).toEqual([
        { key: "v", ctrl: false, shift: false, alt: true, meta: false },
      ]);
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("reports Windows Alt+V clipboard read failures without forwarding the chord", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: vi.fn(async () => null) },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: vi.fn(async () => Promise.reject(new Error("clipboard denied"))) },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", code: "KeyV", altKey: true });

      await waitFor({ predicate: () => mounted.pasteErrors.length === 1 });
      expect(mounted.pasteErrors).toEqual(["clipboard-read-failed"]);
      expect(mounted.terminalKeys).toEqual([]);
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("serializes repeated asynchronous clipboard image pastes", async () => {
    await page.viewport(900, 600);
    let resolveFirstPaste: (path: string | null) => void = () => {};
    const firstPaste = new Promise<string | null>((resolve) => {
      resolveFirstPaste = resolve;
    });
    const onPasteImage = vi
      .fn()
      .mockImplementationOnce(async () => firstPaste)
      .mockResolvedValueOnce("/tmp/second.png");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    const clipboardItem = {
      types: ["image/png"],
      getType: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      presentationStyle: "unspecified" as const,
    } satisfies ClipboardItem;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        read: vi.fn(async () => [clipboardItem]),
      },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const pasteKey = {
      host: mounted.host,
      key: "v",
      code: "KeyV",
      keyCode: 86,
      ...(navigator.platform.includes("Mac") ? { metaKey: true } : { ctrlKey: true }),
    };
    dispatchTerminalKey(pasteKey);
    dispatchTerminalKey(pasteKey);

    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 1 });
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    resolveFirstPaste("/tmp/first.png");
    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 2 });
    await waitFor({ predicate: () => mounted.inputs.length === 2 });
    expect(mounted.inputs).toEqual(["/tmp/first.png", "/tmp/second.png"]);
  });

  it("rejects clipboard images larger than 50MB before reading their bytes", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi.fn(async () => "/tmp/unused.png");
    const onPasteError = vi.fn();
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage, onPasteError },
    });
    const oversizedBlob = { size: 50 * 1024 * 1024 + 1 } as Blob;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        read: vi.fn(async () => [
          {
            types: ["image/png"],
            getType: async () => oversizedBlob,
            presentationStyle: "unspecified" as const,
          } satisfies ClipboardItem,
        ]),
      },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalKey({
      host: mounted.host,
      key: "v",
      code: "KeyV",
      keyCode: 86,
      ...(navigator.platform.includes("Mac") ? { metaKey: true } : { ctrlKey: true }),
    });

    await waitFor({ predicate: () => onPasteError.mock.calls.length > 0 });
    expect(onPasteError).toHaveBeenCalledWith("image-too-large");
    expect(onPasteImage).not.toHaveBeenCalled();
    expect(mounted.inputs).toEqual([]);
  });

  it("prefers clipboard text without reading or uploading images", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi.fn(async () => "/tmp/unused.png");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    const read = vi.fn(async () => [] as ClipboardItem[]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => "first line\nsecond line"),
        read,
      },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("\x1b[?2004h"), onCommitted: resolve });
    });
    dispatchTerminalKey({
      host: mounted.host,
      key: "v",
      code: "KeyV",
      keyCode: 86,
      ...(navigator.platform.includes("Mac") ? { metaKey: true } : { ctrlKey: true }),
    });

    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual(["\x1b[200~first line\rsecond line\x1b[201~"]);
    expect(read).not.toHaveBeenCalled();
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it("leaves Alt+V to the terminal application", async () => {
    await page.viewport(900, 600);
    const readText = vi.fn(async () => "clipboard text");
    const onPasteImage = vi.fn(async () => "/tmp/unused.png");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, read: vi.fn(async () => [] as ClipboardItem[]) },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalKey({
      host: mounted.host,
      key: "v",
      code: "KeyV",
      keyCode: 86,
      altKey: true,
    });
    await nextFrame();

    expect(readText).not.toHaveBeenCalled();
    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it.each([
    { name: "DA1", bytes: "\x1b[c" },
    { name: "DA1-zero", bytes: "\x1b[0c" },
    { name: "DA2", bytes: "\x1b[>c" },
    { name: "DA3", bytes: "\x1b[=c" },
    { name: "DSR-5", bytes: "\x1b[5n" },
    { name: "DSR-6", bytes: "\x1b[6n" },
    { name: "DSR-?6", bytes: "\x1b[?6n" },
    { name: "DECRQM", bytes: "\x1b[1$p" },
    { name: "DECRQM-?", bytes: "\x1b[?1$p" },
    { name: "OSC-10-foreground-color", bytes: "\x1b]10;?\x07" },
    { name: "OSC-11-background-color", bytes: "\x1b]11;?\x07" },
    { name: "OSC-12-cursor-color", bytes: "\x1b]12;?\x07" },
  ])("does not emit a PTY input reply for $name", async ({ bytes }) => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    mounted.runtime.write({ data: terminalOutput(bytes) });
    await nextFrame();
    await nextFrame();

    expect(mounted.inputs).toEqual([]);
  });

  it("replays snapshots without synchronously resetting the visible terminal", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    const terminal = getBrowserTerminal();
    const originalReset = terminal.reset.bind(terminal);
    const reset = vi.fn(originalReset);
    terminal.reset = reset;

    mounted.runtime.renderSnapshot({
      state: {
        rows: terminal.rows,
        cols: terminal.cols,
        scrollback: [],
        grid: [
          [
            { char: "p" },
            { char: "r" },
            { char: "o" },
            { char: "m" },
            { char: "p" },
            { char: "t" },
          ],
        ],
        cursor: {
          row: 0,
          col: 6,
        },
      },
    });
    await nextFrame();

    expect(reset).not.toHaveBeenCalled();
  });
});
