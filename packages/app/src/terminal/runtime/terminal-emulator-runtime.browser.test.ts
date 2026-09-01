import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalInputModeState } from "@getpaseo/protocol/terminal-input-mode";
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
  forceClaim?: boolean;
}

interface TerminalKeyRecord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

type BrowserTerminal = TerminalSize & {
  input: (data: string, wasUserInput?: boolean) => void;
  paste: (text: string) => void;
  refresh: (start: number, end: number) => void;
  reset: () => void;
  getSelection: () => string;
  buffer: {
    active: {
      viewportY: number;
    };
  };
};

interface MountedTerminal {
  host: HTMLDivElement;
  root: HTMLDivElement;
  runtime: TerminalEmulatorRuntime;
  inputs: string[];
  sizes: TerminalSize[];
  terminalKeys: TerminalKeyRecord[];
  inputModeChanges: TerminalInputModeState[];
  selectionChanges: boolean[];
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
  touchSelectionEnabled?: boolean;
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
  const selectionChanges: boolean[] = [];
  const pasteErrors: string[] = [];
  const runtime = new TerminalEmulatorRuntime();
  runtime.setTouchSelectionEnabled({ enabled: input.touchSelectionEnabled ?? false });
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
      onSelectionChange: (hasSelection) => {
        selectionChanges.push(hasSelection);
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
    selectionChanges,
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

function expectNoForcedSameSizeClaim(input: {
  sizes: TerminalSize[];
  startIndex: number;
  baseline: TerminalSize;
}): void {
  const forcedSameSizeClaims = input.sizes
    .slice(input.startIndex)
    .filter(
      (size) =>
        size.rows === input.baseline.rows &&
        size.cols === input.baseline.cols &&
        size.shouldClaim &&
        size.forceClaim,
    );
  expect(forcedSameSizeClaims).toEqual([]);
}

function getBrowserTerminal(): BrowserTerminal {
  const terminal = window.__paseoTerminal as BrowserTerminal | undefined;
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
  return textarea.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: input.key,
      code: input.code ?? "",
      keyCode: input.keyCode ?? 0,
      shiftKey: input.shiftKey ?? false,
      ctrlKey: input.ctrlKey ?? false,
      altKey: input.altKey ?? false,
      metaKey: input.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function dispatchTerminalPaste(input: {
  host: HTMLElement;
  text?: string;
  image?: File;
}): ClipboardEvent {
  const textarea = input.host.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Expected xterm textarea to be mounted");
  }
  const clipboardData = new DataTransfer();
  if (input.text !== undefined) {
    clipboardData.setData("text/plain", input.text);
  }
  if (input.image) {
    clipboardData.items.add(input.image);
  }
  const event = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });
  textarea.dispatchEvent(event);
  return event;
}

function dispatchTerminalTouch(input: {
  target: HTMLElement;
  type: "touchstart" | "touchmove" | "touchend";
  x: number;
  y: number;
}): void {
  const touch = new Touch({
    identifier: 1,
    target: input.target,
    clientX: input.x,
    clientY: input.y,
  });
  input.target.dispatchEvent(
    new TouchEvent(input.type, {
      bubbles: true,
      cancelable: true,
      touches: input.type === "touchend" ? [] : [touch],
      changedTouches: [touch],
    }),
  );
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

function isMacPlatformForTest(): boolean {
  return (
    /Macintosh|Mac OS/i.test(navigator.userAgent ?? "") ||
    /Mac/i.test((navigator as Navigator & { platform?: string }).platform ?? "")
  );
}

function createClipboardItem(mimeType: string, getBlob: () => Promise<Blob>): ClipboardItem {
  return {
    types: [mimeType],
    getType: async (requestedType) => {
      if (requestedType !== mimeType) {
        throw new Error(`Unexpected clipboard MIME type: ${requestedType}`);
      }
      return await getBlob();
    },
    presentationStyle: "unspecified",
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
      predicate: () => window.__paseoTerminal !== undefined,
    });

    expect(window.__paseoTerminal?.options.scrollback).toBe(42_000);
  });

  it("updates scrollback on the mounted xterm", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360, scrollback: 10_000 });

    await waitFor({
      predicate: () => window.__paseoTerminal !== undefined,
    });
    const terminal = window.__paseoTerminal;

    mounted.runtime.setScrollback({ lines: 42_000 });

    expect(window.__paseoTerminal).toBe(terminal);
    expect(window.__paseoTerminal?.options.scrollback).toBe(42_000);
  });

  it("selects the touched word after a long press", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("copy this text"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    dispatchTerminalTouch({
      target: screen,
      type: "touchstart",
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(terminal.getSelection()).toBe("copy");
    expect(mounted.selectionChanges).toEqual([true]);
  });

  it("leaves wide-Web long-press behavior unchanged", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      touchSelectionEnabled: false,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("copy this text"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    dispatchTerminalTouch({
      target: screen,
      type: "touchstart",
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(terminal.getSelection()).toBe("");
    expect(mounted.selectionChanges).toEqual([]);
  });

  it("extends a word selection when a touch drag follows a long press", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("copy this text"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    const y = bounds.top + cellHeight / 2;
    const startX = bounds.left + cellWidth * 1.5;
    const endX = bounds.left + cellWidth * 13.5;

    dispatchTerminalTouch({ target: screen, type: "touchstart", x: startX, y });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(terminal.getSelection()).toBe("copy");

    dispatchTerminalTouch({ target: screen, type: "touchmove", x: endX, y });
    await nextFrame();
    dispatchTerminalTouch({ target: screen, type: "touchend", x: endX, y });

    expect(terminal.getSelection()).toBe("copy this text");
  });

  it("forces local selection while the application tracks the mouse", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({
        data: terminalOutput("\u001b[?1000hcopy this text"),
        onCommitted: resolve,
      });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    dispatchTerminalTouch({
      target: screen,
      type: "touchstart",
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(terminal.getSelection()).toBe("copy");
    expect(mounted.inputs).toEqual([]);
  });

  it("anchors touch selection to complete double-width cells", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("x 你 y"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const y = bounds.top + bounds.height / terminal.rows / 2;
    const selectFrom = async (startColumn: number, endColumn: number): Promise<void> => {
      const startX = bounds.left + cellWidth * (startColumn + 0.5);
      const endX = bounds.left + cellWidth * (endColumn + 0.5);
      dispatchTerminalTouch({ target: screen, type: "touchstart", x: startX, y });
      await new Promise((resolve) => setTimeout(resolve, 700));
      dispatchTerminalTouch({ target: screen, type: "touchmove", x: endX, y });
      await nextFrame();
      dispatchTerminalTouch({ target: screen, type: "touchend", x: endX, y });
    };

    await selectFrom(0, 3);
    expect(terminal.getSelection()).toBe("x 你");

    await selectFrom(5, 3);
    expect(terminal.getSelection()).toBe("你 y");
  });

  it("cancels long-press before vertical and horizontal gesture ownership", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 180,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({
        data: terminalOutput(
          Array.from({ length: 40 }, (_, index) => `scroll line ${index}\r\n`).join(""),
        ),
        onCommitted: resolve,
      });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    const startX = bounds.left + cellWidth * 2.5;
    const startY = bounds.top + cellHeight / 2;
    const viewportBefore = terminal.buffer.active.viewportY;

    dispatchTerminalTouch({ target: screen, type: "touchstart", x: startX, y: startY });
    dispatchTerminalTouch({
      target: screen,
      type: "touchmove",
      x: startX,
      y: startY + cellHeight * 4,
    });
    dispatchTerminalTouch({
      target: screen,
      type: "touchend",
      x: startX,
      y: startY + cellHeight * 4,
    });
    await nextFrame();
    expect(terminal.buffer.active.viewportY).not.toBe(viewportBefore);

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(terminal.getSelection()).toBe("");

    dispatchTerminalTouch({ target: screen, type: "touchstart", x: startX, y: startY });
    dispatchTerminalTouch({
      target: screen,
      type: "touchmove",
      x: startX + cellWidth * 4,
      y: startY,
    });
    dispatchTerminalTouch({
      target: screen,
      type: "touchend",
      x: startX + cellWidth * 4,
      y: startY,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(terminal.getSelection()).toBe("");
  });

  it("copies and clears a selection through the runtime handle", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("copy this text"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    dispatchTerminalTouch({
      target: screen,
      type: "touchstart",
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));

    const copied: string[] = [];
    await expect(
      mounted.runtime.copySelection({
        writeText: async (text) => {
          copied.push(text);
        },
      }),
    ).resolves.toBe("copy");
    expect(copied).toEqual(["copy"]);
    expect(terminal.getSelection()).toBe("");
    expect(mounted.selectionChanges).toEqual([true, false]);
  });

  it("cancels long-press timers and touch listeners on unmount", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("stale selection"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    const touch = {
      target: screen,
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    };
    dispatchTerminalTouch({ ...touch, type: "touchstart" });
    mounted.runtime.unmount();

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mounted.selectionChanges).toEqual([]);
    expect(terminal.getSelection()).toBe("");

    dispatchTerminalTouch({ ...touch, type: "touchstart" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mounted.selectionChanges).toEqual([]);
    expect(terminal.getSelection()).toBe("");
  });

  it("clears active selection state on unmount", async () => {
    await page.viewport(390, 844);
    const mounted = createTerminalHost({
      width: 390,
      height: 500,
      touchSelectionEnabled: true,
    });
    const terminal = getBrowserTerminal();
    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("stale selection"), onCommitted: resolve });
    });

    const screen = mounted.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) {
      throw new Error("Expected xterm screen to be mounted");
    }
    const bounds = screen.getBoundingClientRect();
    const cellWidth = bounds.width / terminal.cols;
    const cellHeight = bounds.height / terminal.rows;
    dispatchTerminalTouch({
      target: screen,
      type: "touchstart",
      x: bounds.left + cellWidth * 1.5,
      y: bounds.top + cellHeight / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mounted.selectionChanges).toEqual([true]);

    mounted.runtime.unmount();

    expect(mounted.selectionChanges).toEqual([true, false]);
  });

  it("does not claim PTY ownership from passive mount refits", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();

    expect(mounted.sizes.length).toBeGreaterThan(1);
    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);

    const settledSize = latestSize(mounted.sizes);
    mounted.runtime.resize({ forceClaim: true, shouldClaim: true });

    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([
      { ...settledSize, shouldClaim: true, forceClaim: true },
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
    mounted.runtime.resize({ forceRefresh: true, shouldClaim: true });

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

  it("keeps passive container measurements local after another client can claim", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 360, height: 180 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();
    const initialSize = latestSize(mounted.sizes);
    mounted.sizes.length = 0;

    mounted.root.style.width = "720px";
    mounted.root.style.height = "360px";

    await waitFor({
      predicate: () =>
        mounted.sizes.some((size) => size.cols > initialSize.cols && size.rows > initialSize.rows),
    });

    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);
  });

  it("keeps visual viewport keyboard refits passive", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 360, height: 180 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();
    mounted.sizes.length = 0;

    mounted.root.style.width = "720px";
    mounted.root.style.height = "360px";
    expect(window.visualViewport).not.toBeNull();
    window.visualViewport?.dispatchEvent(new Event("resize"));

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);
  });

  it("keeps browser window refits passive", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 360, height: 180 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();
    mounted.sizes.length = 0;

    mounted.root.style.width = "720px";
    mounted.root.style.height = "360px";
    window.dispatchEvent(new Event("resize"));

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);
  });

  it("does not force-claim a same-size resize while forwarding ordinary terminal input", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const sizeCount = mounted.sizes.length;
    const sizeBeforeInput = latestSize(mounted.sizes);
    const terminal = getBrowserTerminal();

    terminal.input("a", true);

    await waitFor({ predicate: () => mounted.inputs.length > 0 });

    expect(mounted.inputs.at(-1)).toBe("a");
    expectNoForcedSameSizeClaim({
      sizes: mounted.sizes,
      startIndex: sizeCount,
      baseline: sizeBeforeInput,
    });
  });

  it("does not read the clipboard during keydown for the standard paste shortcut", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });
    const readText = vi.fn(async () => "stale clipboard text");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalKey({
      host: mounted.host,
      key: "v",
      ...(isMacPlatformForTest() ? { metaKey: true } : { ctrlKey: true }),
    });
    await nextFrame();

    expect(readText).not.toHaveBeenCalled();
  });

  it.each([
    { mimeType: "image/png", fileExtension: "png" },
    { mimeType: "image/jpeg", fileExtension: "jpg" },
    { mimeType: "image/gif", fileExtension: "gif" },
    { mimeType: "image/webp", fileExtension: "webp" },
  ])(
    "uploads $mimeType clipboard data and pastes one forced bracketed path",
    async ({ mimeType, fileExtension }) => {
      await page.viewport(900, 600);
      const imageBytes = new Uint8Array([137, 80, 78, 71]);
      const uploadedImages: Array<{
        bytes: Uint8Array;
        mimeType: string;
        fileExtension: string;
      }> = [];
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: {
          onPasteImage: async (image) => {
            uploadedImages.push(image);
            return `/tmp/clipboard image.${fileExtension}`;
          },
        },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalPaste({
        host: mounted.host,
        image: new File([imageBytes], `clipboard.${fileExtension}`, { type: mimeType }),
      });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(uploadedImages).toHaveLength(1);
      expect([...uploadedImages[0]!.bytes]).toEqual([...imageBytes]);
      expect(uploadedImages[0]).toMatchObject({ mimeType, fileExtension });
      expect(mounted.inputs).toEqual([`\x1b[200~/tmp/clipboard image.${fileExtension}\x1b[201~`]);
    },
  );

  it("prefers one supported image over text from the same paste event", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi.fn(async () => "/tmp/uploaded.jpg");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    const clipboardText = "/Users/example/PixPin/capture.jpg";

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({
      host: mounted.host,
      text: clipboardText,
      image: new File([new Uint8Array([1, 2, 3])], "capture.jpg", {
        type: "image/jpeg",
      }),
    });

    await waitFor({ predicate: () => mounted.inputs.length === 1 });
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    expect(mounted.inputs).toEqual(["\x1b[200~/tmp/uploaded.jpg\x1b[201~"]);
    expect(mounted.inputs.join("")).not.toContain(clipboardText);
  });

  it("falls back to ordinary text paste for an unsupported image flavor", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi.fn(async () => "/tmp/unused.bmp");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({
      host: mounted.host,
      text: "fallback text",
      image: new File([new Uint8Array([1, 2, 3])], "capture.bmp", {
        type: "image/bmp",
      }),
    });

    await waitFor({ predicate: () => mounted.inputs.length === 1 });
    expect(onPasteImage).not.toHaveBeenCalled();
    expect(mounted.inputs).toEqual(["fallback text"]);
  });

  it("falls back to text when image upload is unavailable", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({
      host: mounted.host,
      text: "fallback text",
      image: new File([new Uint8Array([1, 2, 3])], "capture.png", {
        type: "image/png",
      }),
    });

    await waitFor({ predicate: () => mounted.inputs.length === 1 });
    expect(mounted.inputs).toEqual(["fallback text"]);
  });

  it("rejects an oversized clipboard image before reading its bytes", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
      const onPasteImage = vi.fn(async () => "/tmp/unused.png");
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage },
      });
      const oversizedBlob = {
        size: 50 * 1024 * 1024 + 1,
        arrayBuffer,
      } as unknown as Blob;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          read: async () => [createClipboardItem("image/png", async () => oversizedBlob)],
        },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", altKey: true });

      await waitFor({ predicate: () => mounted.pasteErrors.length === 1 });
      expect(mounted.pasteErrors).toEqual(["image-too-large"]);
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(onPasteImage).not.toHaveBeenCalled();
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("continues queued image pastes after a failed upload", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi
      .fn()
      .mockRejectedValueOnce(new Error("upload failed"))
      .mockResolvedValueOnce("/tmp/second.png");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    const image = new File([new Uint8Array([1, 2, 3])], "clipboard.png", {
      type: "image/png",
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({ host: mounted.host, image });
    dispatchTerminalPaste({ host: mounted.host, image });

    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 2 });
    await waitFor({ predicate: () => mounted.inputs.length === 1 });
    expect(mounted.pasteErrors).toEqual(["clipboard-read-failed"]);
    expect(mounted.inputs).toEqual(["\x1b[200~/tmp/second.png\x1b[201~"]);
  });

  it("does not duplicate an upload error when the image callback returns no path", async () => {
    await page.viewport(900, 600);
    const onPasteImage = vi.fn(async () => null);
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({
      host: mounted.host,
      image: new File([new Uint8Array([1, 2, 3])], "clipboard.png", {
        type: "image/png",
      }),
    });

    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 1 });
    await nextFrame();
    expect(mounted.pasteErrors).toEqual([]);
    expect(mounted.inputs).toEqual([]);
  });

  it("preserves queued image order without delaying ordinary terminal input", async () => {
    await page.viewport(900, 600);
    let resolveFirstUpload: (path: string) => void = () => {};
    const firstUpload = new Promise<string>((resolve) => {
      resolveFirstUpload = resolve;
    });
    const onPasteImage = vi
      .fn()
      .mockImplementationOnce(() => firstUpload)
      .mockResolvedValueOnce("/tmp/second.png");
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });
    const firstImage = new File([new Uint8Array([1])], "first.png", { type: "image/png" });
    const secondImage = new File([new Uint8Array([2])], "second.png", {
      type: "image/png",
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({ host: mounted.host, image: firstImage });
    dispatchTerminalPaste({ host: mounted.host, image: secondImage });
    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 1 });

    getBrowserTerminal().input("ordinary-input", true);
    await waitFor({ predicate: () => mounted.inputs.length === 1 });
    expect(mounted.inputs).toEqual(["ordinary-input"]);

    resolveFirstUpload("/tmp/first.png");
    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 2 });
    await waitFor({ predicate: () => mounted.inputs.length === 3 });
    expect([...onPasteImage.mock.calls[0]![0].bytes]).toEqual([1]);
    expect([...onPasteImage.mock.calls[1]![0].bytes]).toEqual([2]);
    expect(mounted.inputs).toEqual([
      "ordinary-input",
      "\x1b[200~/tmp/first.png\x1b[201~",
      "\x1b[200~/tmp/second.png\x1b[201~",
    ]);
  });

  it("suppresses a stale uploaded path after unmount", async () => {
    await page.viewport(900, 600);
    let resolveUpload: (path: string) => void = () => {};
    const upload = new Promise<string>((resolve) => {
      resolveUpload = resolve;
    });
    const onPasteImage = vi.fn(() => upload);
    const mounted = createTerminalHost({
      width: 720,
      height: 360,
      callbacks: { onPasteImage },
    });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    dispatchTerminalPaste({
      host: mounted.host,
      image: new File([new Uint8Array([1])], "clipboard.png", { type: "image/png" }),
    });
    await waitFor({ predicate: () => onPasteImage.mock.calls.length === 1 });

    mounted.runtime.unmount();
    resolveUpload("/tmp/stale.png");
    await nextFrame();
    await nextFrame();
    expect(mounted.inputs).toEqual([]);
    expect(mounted.pasteErrors).toEqual([]);
  });

  it("uses a clipboard image for Pi's Windows Alt+V shortcut", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const onPasteImage = vi.fn(async () => "/tmp/windows.png");
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          read: async () => [
            createClipboardItem(
              "image/png",
              async () => new Blob([new Uint8Array([137, 80, 78, 71])]),
            ),
          ],
        },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", altKey: true });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(onPasteImage).toHaveBeenCalledTimes(1);
      expect(mounted.inputs).toEqual(["\x1b[200~/tmp/windows.png\x1b[201~"]);
      expect(mounted.terminalKeys).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("forwards Windows Alt+V after a successful clipboard read with no image", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: async () => null },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: async () => [] },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", altKey: true });

      await waitFor({ predicate: () => mounted.terminalKeys.length === 1 });
      expect(mounted.terminalKeys).toEqual([
        { key: "v", ctrl: false, shift: false, alt: true, meta: false },
      ]);
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("passes Windows Alt+V through when Async Clipboard is unavailable", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: async () => null },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {},
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({
        host: mounted.host,
        key: "v",
        code: "KeyV",
        keyCode: 86,
        altKey: true,
      });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(mounted.inputs).toEqual(["\x1bv"]);
      expect(mounted.terminalKeys).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("does not read Windows clipboard images without an upload callback", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const read = vi.fn(async () => [] as ClipboardItem[]);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({
        host: mounted.host,
        key: "v",
        code: "KeyV",
        keyCode: 86,
        altKey: true,
      });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(read).not.toHaveBeenCalled();
      expect(mounted.inputs).toEqual(["\x1bv"]);
    } finally {
      restorePlatform();
    }
  });

  it("reports Windows clipboard permission failure without forwarding Alt+V", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: async () => null },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: async () => Promise.reject(new Error("clipboard denied")) },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", altKey: true });

      await waitFor({ predicate: () => mounted.pasteErrors.length === 1 });
      expect(mounted.pasteErrors).toEqual(["clipboard-read-failed"]);
      expect(mounted.terminalKeys).toEqual([]);
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("leaves non-Windows Alt+V unchanged", async () => {
    const restorePlatform = setNavigatorPlatform("Linux x86_64");
    try {
      await page.viewport(900, 600);
      const read = vi.fn(async () => [] as ClipboardItem[]);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: async () => null },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({
        host: mounted.host,
        key: "v",
        code: "KeyV",
        keyCode: 86,
        altKey: true,
      });

      await waitFor({ predicate: () => mounted.inputs.length === 1 });
      expect(read).not.toHaveBeenCalled();
      expect(mounted.inputs).toEqual(["\x1bv"]);
    } finally {
      restorePlatform();
    }
  });

  it("suppresses a delayed clipboard error after unmount", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      let rejectRead: (error: Error) => void = () => {};
      const readResult = new Promise<ClipboardItem[]>((_resolve, reject) => {
        rejectRead = reject;
      });
      const read = vi.fn(() => readResult);
      const mounted = createTerminalHost({
        width: 720,
        height: 360,
        callbacks: { onPasteImage: async () => null },
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read },
      });

      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      dispatchTerminalKey({ host: mounted.host, key: "v", altKey: true });
      await waitFor({ predicate: () => read.mock.calls.length === 1 });
      mounted.runtime.unmount();
      rejectRead(new Error("clipboard denied"));
      await nextFrame();
      await nextFrame();

      expect(mounted.pasteErrors).toEqual([]);
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
  });

  it("pastes through xterm's input producer", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    mounted.runtime.paste("legacy renderer paste");

    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual(["legacy renderer paste"]);
  });

  it("preserves bracketed paste mode before and after snapshot replay", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const terminal = getBrowserTerminal();
    const paste = "first line\nsecond line";
    const expected = "\x1b[200~first line\rsecond line\x1b[201~";

    await new Promise<void>((resolve) => {
      mounted.runtime.write({ data: terminalOutput("\x1b[?2004h"), onCommitted: resolve });
    });
    terminal.paste(paste);
    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual([expected]);

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
      mounted.runtime.write({ data: terminalOutput("\x1b[?2004h"), onCommitted: resolve });
    });

    terminal.paste(paste);
    await waitFor({ predicate: () => mounted.inputs.length > 0 });
    expect(mounted.inputs).toEqual([expected]);
  });

  it("forces and sanitizes multiline text on the Windows paste boundary", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      await waitFor({ predicate: () => mounted.sizes.length > 0 });

      mounted.runtime.paste("first line\nsecond\x1b[201~line");

      await waitFor({ predicate: () => mounted.inputs.length > 0 });
      expect(mounted.inputs).toEqual(["\x1b[200~first line\rsecond\u241b[201~line\x1b[201~"]);
    } finally {
      restorePlatform();
    }
  });

  it("frames multiline clipboard paste events on Windows and blocks their default propagation", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    let bubbled = false;
    const onPaste = () => {
      bubbled = true;
    };
    document.body.addEventListener("paste", onPaste);
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      await waitFor({ predicate: () => mounted.sizes.length > 0 });

      const event = dispatchTerminalPaste({
        host: mounted.host,
        text: "first line\nsecond\x1bline",
      });

      await waitFor({ predicate: () => mounted.inputs.length > 0 });
      expect(mounted.inputs).toEqual(["\x1b[200~first line\rsecond\u241bline\x1b[201~"]);
      expect(event.defaultPrevented).toBe(true);
      expect(bubbled).toBe(false);
    } finally {
      document.body.removeEventListener("paste", onPaste);
      restorePlatform();
    }
  });

  it("keeps single-line Windows clipboard paste on the plain xterm path", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      await waitFor({ predicate: () => mounted.sizes.length > 0 });

      dispatchTerminalPaste({ host: mounted.host, text: "single line" });

      await waitFor({ predicate: () => mounted.inputs.length > 0 });
      expect(mounted.inputs).toEqual(["single line"]);
    } finally {
      restorePlatform();
    }
  });

  it("keeps non-Windows multiline paste on the plain xterm path", async () => {
    const restorePlatform = setNavigatorPlatform("Linux x86_64");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      await waitFor({ predicate: () => mounted.sizes.length > 0 });

      mounted.runtime.paste("first line\nsecond line");

      await waitFor({ predicate: () => mounted.inputs.length > 0 });
      expect(mounted.inputs).toEqual(["first line\rsecond line"]);
    } finally {
      restorePlatform();
    }
  });

  it("removes the Windows multiline paste listener on unmount", async () => {
    const restorePlatform = setNavigatorPlatform("Win32");
    try {
      await page.viewport(900, 600);
      const mounted = createTerminalHost({ width: 720, height: 360 });
      await waitFor({ predicate: () => mounted.sizes.length > 0 });
      mounted.runtime.unmount();

      const staleClipboardData = new DataTransfer();
      staleClipboardData.setData("text/plain", "stale first\nstale second");
      mounted.host.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: staleClipboardData,
        }),
      );
      await nextFrame();
      expect(mounted.inputs).toEqual([]);
    } finally {
      restorePlatform();
    }
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

    mounted.runtime.resize({ forceRefresh: true, shouldClaim: false });

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

    const sizeCount = mounted.sizes.length;
    const sizeBeforeKey = latestSize(mounted.sizes);
    mounted.terminalKeys.length = 0;

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
    expectNoForcedSameSizeClaim({
      sizes: mounted.sizes,
      startIndex: sizeCount,
      baseline: sizeBeforeKey,
    });
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
