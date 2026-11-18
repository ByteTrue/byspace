import { describe, expect, it } from "vitest";
import {
  extractTerminalDropPaths,
  isTerminalDragLeaveOutside,
  isTerminalFileDrag,
  prepareDroppedPathForTerminal,
  prepareDroppedPathsForTerminal,
} from "./terminal-file-drop";

function dataTransfer(input: { types?: string[]; files?: File[] }): DataTransfer {
  return {
    types: input.types ?? [],
    files: input.files ?? [],
  } as unknown as DataTransfer;
}

function fakeFile(input: { name: string; legacyPath?: string }): File {
  const file = { name: input.name } as unknown as File;
  if (input.legacyPath !== undefined) {
    Object.defineProperty(file, "path", {
      configurable: true,
      value: input.legacyPath,
    });
  }
  return file;
}

function makeNode(children: readonly EventTarget[] = []): EventTarget {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    contains: (other: EventTarget | null) => other !== null && children.includes(other),
  } as unknown as EventTarget;
}

describe("terminal file drop", () => {
  it("detects file drags", () => {
    expect(isTerminalFileDrag(dataTransfer({ types: ["Files"] }))).toBe(true);
    expect(isTerminalFileDrag(dataTransfer({ types: ["text/plain"] }))).toBe(false);
    expect(isTerminalFileDrag(null)).toBe(false);
  });

  it("keeps drag highlight active when moving between terminal children", () => {
    const child = makeNode();
    const outside = makeNode();
    const root = makeNode([child]);

    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: child })).toBe(false);
    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: outside })).toBe(true);
    expect(isTerminalDragLeaveOutside({ currentTarget: root, relatedTarget: null })).toBe(true);
    expect(isTerminalDragLeaveOutside({ currentTarget: null, relatedTarget: child })).toBe(true);
  });

  it("extracts legacy browser file paths", () => {
    const file = fakeFile({ name: "photo.png", legacyPath: "/tmp/legacy-photo.png" });

    expect(extractTerminalDropPaths(dataTransfer({ types: ["Files"], files: [file] }))).toEqual([
      "/tmp/legacy-photo.png",
    ]);
  });

  it("drops browser files that have no filesystem path", () => {
    const file = fakeFile({ name: "photo.png" });

    expect(extractTerminalDropPaths(dataTransfer({ types: ["Files"], files: [file] }))).toEqual([]);
  });

  it("prepares POSIX paths with conservative escaping", () => {
    expect(prepareDroppedPathForTerminal("/tmp/my image.png")).toBe("'/tmp/my image.png'");
    expect(prepareDroppedPathForTerminal("/tmp/a$(touch bad).png")).toBe("'/tmp/a(touch bad).png'");
    expect(prepareDroppedPathForTerminal("/tmp/it's.png")).toBe("'/tmp/it\\'s.png'");
  });

  it("joins multiple dropped paths for one terminal input", () => {
    expect(prepareDroppedPathsForTerminal(["/tmp/a.png", "/tmp/b c.png"])).toBe(
      "'/tmp/a.png' '/tmp/b c.png'",
    );
  });
});
