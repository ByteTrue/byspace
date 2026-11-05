// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowTitleBar } from "./desktop-window-titlebar";

type Listener = (event: { name: string; data?: unknown }) => void;
const listeners = new Map<string, Listener>();

beforeEach(() => {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
  vi.spyOn(window, "location", "get").mockReturnValue({
    protocol: "wails:",
    hostname: "wails.localhost",
  } as Location);
  Object.assign(window, {
    wails: {
      Events: {
        On: (name: string, listener: Listener) => {
          listeners.set(name, listener);
          return () => listeners.delete(name);
        },
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ maximized: false }) })),
  );
});

afterEach(() => {
  cleanup();
  listeners.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesktopWindowTitleBar", () => {
  it("follows native maximize and restore, including keyboard snapping", () => {
    const view = render(
      <DesktopWindowTitleBar showLeadingNav={false} onToggleSidebar={() => {}} />,
    );
    expect(view.getByRole("button", { name: "Maximize" })).toBeTruthy();

    act(() => {
      listeners.get("byspace:window-maximized")?.({ name: "byspace:window-maximized", data: true });
    });
    expect(view.getByRole("button", { name: "Restore" })).toBeTruthy();

    act(() => {
      listeners.get("byspace:window-maximized")?.({
        name: "byspace:window-maximized",
        data: false,
      });
    });
    expect(view.getByRole("button", { name: "Maximize" })).toBeTruthy();
  });

  it("does not zoom the window when a control is double-clicked", () => {
    const view = render(
      <DesktopWindowTitleBar showLeadingNav={false} onToggleSidebar={() => {}} />,
    );
    const minimize = view.getByRole("button", { name: "Minimize" });
    fireEvent.doubleClick(minimize);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/_byspace/desktop/window",
      expect.objectContaining({ body: JSON.stringify({ action: "query" }) }),
    );
    fireEvent.click(minimize);
    expect(fetch).toHaveBeenCalledWith(
      "/_byspace/desktop/window",
      expect.objectContaining({ body: JSON.stringify({ action: "minimize" }) }),
    );
  });

  it("maximizes only once for a native double-click", () => {
    const view = render(
      <DesktopWindowTitleBar showLeadingNav={false} onToggleSidebar={() => {}} />,
    );
    const maximize = view.getByRole("button", { name: "Maximize" });
    fireEvent.click(maximize, { detail: 1 });
    fireEvent.click(maximize, { detail: 2 });
    fireEvent.doubleClick(maximize, { detail: 2 });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.body === JSON.stringify({ action: "maximize" })),
    ).toHaveLength(1);
  });

  it("reads native state when the titlebar remounts", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ maximized: true }),
    } as Response);
    const view = render(
      <DesktopWindowTitleBar showLeadingNav={false} onToggleSidebar={() => {}} />,
    );
    expect(await view.findByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("zooms from the drag surface once", () => {
    const view = render(
      <DesktopWindowTitleBar showLeadingNav={false} onToggleSidebar={() => {}} />,
    );
    fireEvent.doubleClick(view.getByTestId("desktop-window-titlebar"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      "/_byspace/desktop/window",
      expect.objectContaining({ body: JSON.stringify({ action: "maximize" }) }),
    );
  });
});
