import { describe, it, expect } from "vitest";
import { detectInstalledShells, parseDsclUserShell, parseEtcShells } from "./shell-detect.js";

function makeExists(paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe("parseEtcShells", () => {
  it("extracts absolute paths and skips comments and blanks", () => {
    const text = [
      "# /etc/shells: valid login shells",
      "/bin/sh",
      "",
      "  /bin/bash  ",
      "not-absolute",
      "#/bin/commented",
      "/usr/local/bin/fish",
    ].join("\n");
    expect(parseEtcShells(text)).toEqual(["/bin/sh", "/bin/bash", "/usr/local/bin/fish"]);
  });
});

describe("parseDsclUserShell", () => {
  it("parses the UserShell line", () => {
    expect(parseDsclUserShell("UserShell: /bin/zsh\n")).toBe("/bin/zsh");
  });

  it("returns null when the line is missing or the value is not absolute", () => {
    expect(parseDsclUserShell("RecordName: byte\n")).toBeNull();
    expect(parseDsclUserShell("UserShell: zsh\n")).toBeNull();
  });
});

describe("detectInstalledShells", () => {
  it("returns existing candidates in order and dedupes by path", async () => {
    const shells = await detectInstalledShells({
      platform: "linux",
      env: { SHELL: "/bin/zsh", HOME: "/home/user" },
      candidates: [
        { location: "/bin/zsh", source: "env" },
        { location: "/bin/zsh", source: "etc-shells" },
        { location: "/bin/bash", source: "etc-shells" },
        { location: "/bin/fish", source: "well-known" },
      ],
      exists: makeExists(["/bin/zsh", "/bin/bash"]),
    });
    expect(shells).toEqual([
      { path: "/bin/zsh", name: "zsh" },
      { path: "/bin/bash", name: "bash" },
    ]);
  });

  it("merges env shell, macOS login shell, and well-known paths without duplicates", async () => {
    const shells = await detectInstalledShells({
      platform: "darwin",
      env: { SHELL: "/bin/zsh", HOME: "/Users/byte" },
      readMacUserShell: () => "/opt/homebrew/bin/fish",
      readEtcShells: () => "/bin/sh\n/bin/zsh\n",
      exists: makeExists(["/bin/zsh", "/opt/homebrew/bin/fish", "/bin/sh"]),
    });
    expect(shells).toEqual([
      { path: "/bin/zsh", name: "zsh" },
      { path: "/opt/homebrew/bin/fish", name: "fish" },
      { path: "/bin/sh", name: "sh" },
    ]);
  });

  it("keeps going when the macOS login-shell lookup fails", async () => {
    const shells = await detectInstalledShells({
      platform: "darwin",
      env: { SHELL: "/bin/bash", HOME: "/Users/byte" },
      readMacUserShell: () => null,
      readEtcShells: () => "/bin/zsh\n",
      exists: makeExists(["/bin/bash", "/bin/zsh"]),
    });
    expect(shells).toEqual([
      { path: "/bin/bash", name: "bash" },
      { path: "/bin/zsh", name: "zsh" },
    ]);
  });

  it("ignores a non-absolute SHELL value", async () => {
    const shells = await detectInstalledShells({
      platform: "linux",
      env: { SHELL: "fish", HOME: "/home/user" },
      readEtcShells: () => "/bin/bash\n",
      exists: makeExists(["/bin/bash"]),
    });
    expect(shells).toEqual([{ path: "/bin/bash", name: "bash" }]);
  });

  it("resolves bare Windows candidates against PATH", async () => {
    const shells = await detectInstalledShells({
      platform: "win32",
      env: { PATH: "C:\\Windows\\System32" },
      resolveOnPath: (name) =>
        name === "pwsh" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null,
      exists: makeExists(["C:\\Program Files\\PowerShell\\7\\pwsh.exe"]),
    });
    expect(shells).toEqual([
      { path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", name: "pwsh.exe" },
    ]);
  });
});
