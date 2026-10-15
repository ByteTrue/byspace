import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import { isChiefSessionVisible } from "./chief-visibility";

function paneLayout(input: {
  tabId: string;
  target: { kind: "agent"; agentId: string } | { kind: "file"; path: string };
}): WorkspaceLayout {
  return {
    focusedPaneId: "main",
    root: {
      kind: "pane",
      pane: {
        id: "main",
        tabIds: [input.tabId],
        focusedTabId: input.tabId,
        tabs: [{ tabId: input.tabId, target: input.target, createdAt: 1 }],
      },
    },
  } as unknown as WorkspaceLayout;
}

describe("chief session visibility", () => {
  it("hides the entry once the chief tab is the conversation on screen", () => {
    // The maximized window and the compact tap both leave this shape behind:
    // a workspace route whose focused tab is the chief agent. The route has
    // already consumed its ?open= intent by then, so the layout is the only
    // remaining evidence.
    expect(
      isChiefSessionVisible({
        layout: paneLayout({ tabId: "chief", target: { kind: "agent", agentId: "chief-1" } }),
        chiefAgentId: "chief-1",
        focusedPaneOnly: true,
      }),
    ).toBe(true);
  });

  it("keeps the entry while another agent holds the screen", () => {
    expect(
      isChiefSessionVisible({
        layout: paneLayout({ tabId: "other", target: { kind: "agent", agentId: "agent-2" } }),
        chiefAgentId: "chief-1",
        focusedPaneOnly: true,
      }),
    ).toBe(false);
  });

  it("keeps the entry while the chief tab is open but backgrounded", () => {
    const layout = paneLayout({ tabId: "other", target: { kind: "file", path: "/repo/a.ts" } });
    layout.root = {
      kind: "pane",
      pane: {
        id: "main",
        tabIds: ["other", "chief"],
        focusedTabId: "other",
        tabs: [
          { tabId: "other", target: { kind: "file", path: "/repo/a.ts" }, createdAt: 1 },
          { tabId: "chief", target: { kind: "agent", agentId: "chief-1" }, createdAt: 2 },
        ],
      },
    } as unknown as WorkspaceLayout["root"];

    expect(isChiefSessionVisible({ layout, chiefAgentId: "chief-1", focusedPaneOnly: true })).toBe(
      false,
    );
  });

  it("keeps the entry before the chief agent resolves", () => {
    expect(
      isChiefSessionVisible({
        layout: paneLayout({ tabId: "chief", target: { kind: "agent", agentId: "chief-1" } }),
        chiefAgentId: null,
        focusedPaneOnly: true,
      }),
    ).toBe(false);
    expect(
      isChiefSessionVisible({ layout: undefined, chiefAgentId: "chief-1", focusedPaneOnly: true }),
    ).toBe(false);
  });
});
