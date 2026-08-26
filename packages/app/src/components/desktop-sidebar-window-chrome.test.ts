import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentsDir = dirname(fileURLToPath(import.meta.url));

function readSource(path: string): string {
  return readFileSync(resolve(componentsDir, path), "utf8");
}

describe("desktop sidebar window chrome", () => {
  it("keeps a single content-owned sidebar toggle", () => {
    const appLayoutSource = readSource("../app/_layout.tsx");
    const menuHeaderSource = readSource("headers/menu-header.tsx");

    expect(appLayoutSource).not.toContain("WindowSidebarMenuToggle");
    expect(menuHeaderSource).not.toContain("WindowSidebarMenuToggle");
    expect(menuHeaderSource).toContain("<SidebarMenuToggle />");
  });

  it("moves sidebar and content rows clear of their owned window controls", () => {
    const sidebarSource = readSource("left-sidebar.tsx");
    const screenHeaderSource = readSource("headers/screen-header.tsx");

    expect(sidebarSource).toContain('<WindowChromeSafeArea placement="below"');
    expect(screenHeaderSource).toContain('placement="inline"');
  });
});
