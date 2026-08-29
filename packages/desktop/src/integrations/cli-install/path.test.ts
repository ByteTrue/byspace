import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/BySpace.app/Contents/MacOS/BySpace",
        shimPath: "/Applications/BySpace.app/Contents/Resources/bin/byspace",
      }),
    ).toBe("/Applications/BySpace.app/Contents/Resources/bin/byspace");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_byspace123/byspace",
        shimPath: "/tmp/.mount_byspace123/resources/bin/byspace",
        appImagePath: "/home/user/Applications/BySpace.AppImage",
      }),
    ).toBe("/home/user/Applications/BySpace.AppImage");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\BySpace\\BySpace.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\BySpace\\resources\\bin\\byspace.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\BySpace\\resources\\bin\\byspace.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/BySpace/byspace",
        shimPath: "/opt/BySpace/resources/bin/byspace",
      }),
    ).toBe("/opt/BySpace/resources/bin/byspace");
  });
});
