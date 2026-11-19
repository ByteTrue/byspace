// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopGeneralRows } from "./desktop-app-section";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("DesktopGeneralRows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads /_byspace/desktop/settings on loopback and renders Open at login and Prevent sleep without Dock or Lightweight toggles", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        desktop: true,
        platform: "darwin",
        openAtLogin: true,
        settings: {
          keepAwake: "system",
          noAutoUpdate: false,
          updateEvery: 60,
          noAutoDownload: false,
          autoRestart: false,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(React.createElement(DesktopGeneralRows));
    });

    expect(fetchMock).toHaveBeenCalledWith("/_byspace/desktop/settings", { method: "GET" });
    expect(container.textContent).toContain("Open at login");
    expect(container.textContent).toContain("Prevent sleep");
    expect(container.textContent).not.toContain("Show in Dock");
    expect(container.textContent).not.toContain("Lightweight mode");
  });
});
