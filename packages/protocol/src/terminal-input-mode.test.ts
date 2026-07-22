import { describe, expect, it } from "vitest";
import { TerminalInputModeTracker } from "./terminal-input-mode.js";

describe("TerminalInputModeTracker", () => {
  it("activates from a pushed Kitty keyboard mode and builds a replay preamble", () => {
    const tracker = new TerminalInputModeTracker();

    expect(tracker.feed("\x1b[>7u").changed).toBe(true);

    expect(tracker.supportsModifiedEnter()).toBe(true);
    expect(tracker.getKittyKeyboardFlags()).toBe(7);
    expect(tracker.getPreamble()).toBe("\x1b[=7;1u");
  });

  it("tracks split terminal output chunks", () => {
    const tracker = new TerminalInputModeTracker();

    tracker.feed("\x1b[>");
    const result = tracker.feed("1u");

    expect(result.changed).toBe(true);
    expect(tracker.getKittyKeyboardFlags()).toBe(1);
  });

  it("restores pushed Kitty keyboard modes when the foreground program pops them", () => {
    const tracker = new TerminalInputModeTracker();

    tracker.feed("\x1b[>1u");
    tracker.feed("\x1b[>7u");
    expect(tracker.getKittyKeyboardFlags()).toBe(7);

    expect(tracker.feed("\x1b[<u").changed).toBe(true);
    expect(tracker.getKittyKeyboardFlags()).toBe(1);

    expect(tracker.feed("\x1b[<u").changed).toBe(true);
    expect(tracker.supportsModifiedEnter()).toBe(false);
  });

  it("answers Kitty keyboard mode queries with the current flags", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("\x1b[=3;1u");

    expect(tracker.feed("\x1b[?u").responses).toEqual(["\x1b[?3u"]);
  });

  it("tracks bracketed paste mode across split chunks and replay", () => {
    const tracker = new TerminalInputModeTracker();

    expect(tracker.feed("\x1b[?20").changed).toBe(false);
    expect(tracker.feed("04h").changed).toBe(true);

    expect(tracker.getState()).toEqual({
      kittyKeyboardFlags: 0,
      bracketedPasteMode: true,
      win32InputMode: false,
    });
    expect(tracker.getPreamble()).toBe("\x1b[?2004h");

    expect(tracker.feed("\x1b[?2004l").changed).toBe(true);
    expect(tracker.getState().bracketedPasteMode).toBe(false);
    expect(tracker.getPreamble()).toBe("");
  });

  it("tracks ConPTY Win32 input mode and replays it after snapshots", () => {
    const tracker = new TerminalInputModeTracker();

    expect(tracker.feed("\x1b[?9001h").changed).toBe(true);

    expect(tracker.getState()).toEqual({
      kittyKeyboardFlags: 0,
      bracketedPasteMode: false,
      win32InputMode: true,
    });
    expect(tracker.supportsModifiedEnter()).toBe(true);
    expect(tracker.getPreamble()).toBe("\x1b[?9001h");

    expect(tracker.feed("\x1b[?9001l").changed).toBe(true);
    expect(tracker.supportsModifiedEnter()).toBe(false);
  });

  it("keeps Kitty and Win32 input modes independent", () => {
    const tracker = new TerminalInputModeTracker();

    tracker.feed("\x1b[>7u\x1b[?9001h");

    expect(tracker.getState()).toEqual({
      kittyKeyboardFlags: 7,
      bracketedPasteMode: false,
      win32InputMode: true,
    });
    expect(tracker.getPreamble()).toBe("\x1b[=7;1u\x1b[?9001h");
  });

  it("tracks bracketed paste and Win32 modes in one private-mode sequence", () => {
    const tracker = new TerminalInputModeTracker();

    expect(tracker.feed("\x1b[?2004;9001h").changed).toBe(true);

    expect(tracker.getState()).toEqual({
      kittyKeyboardFlags: 0,
      bracketedPasteMode: true,
      win32InputMode: true,
    });
    expect(tracker.getPreamble()).toBe("\x1b[?2004h\x1b[?9001h");
  });

  it("ignores encoded key input sequences", () => {
    const tracker = new TerminalInputModeTracker();

    tracker.feed("\x1b[13;2u");

    expect(tracker.supportsModifiedEnter()).toBe(false);
  });
});
