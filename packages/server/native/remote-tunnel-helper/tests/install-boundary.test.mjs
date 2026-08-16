import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installer = readFileSync(new URL("../install.mjs", import.meta.url), "utf8");

describe("Remote Tunnel installer privilege boundary", () => {
  it("does not execute a user-owned privileged script", () => {
    expect(installer).not.toContain("temporaryScript");
    expect(installer).not.toContain("writeFileSync");
    expect(installer).toContain("| /bin/sh -s --");
  });

  it("rechecks staged artifacts as root before publishing", () => {
    expect(installer).toContain("actual_helper_sha=");
    expect(installer).toContain("actual_supervisor_sha=");
    expect(installer).toContain("Remote Tunnel artifact changed during authorization");
    expect(installer).toContain('codesign --verify --strict "$helper_stage"');
    expect(installer).toContain('codesign --verify --strict "$supervisor_stage"');
  });

  it("refuses replacement before and after authorization", () => {
    expect(installer.indexOf("initial-install only")).toBeLessThan(
      installer.indexOf('"/usr/bin/osascript"'),
    );
    expect(installer).toContain("refusing a second authorization path");
    expect(installer).not.toContain("previous-helper");
    expect(installer).not.toContain("previous-supervisor");
  });
});
