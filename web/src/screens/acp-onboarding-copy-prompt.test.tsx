// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPrompt = vi.fn();
const writeText = vi.fn();
const copied = vi.fn();
const error = vi.fn();
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ getAcpOnboardingPrompt: getPrompt }),
}));
vi.mock("@/platform/clipboard", () => ({ writeText: (...args: unknown[]) => writeText(...args) }));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ copied, error }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { AcpOnboardingCopyPrompt } from "./acp-onboarding-copy-prompt";

describe("AcpOnboardingCopyPrompt", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    getPrompt.mockReset();
    writeText.mockReset();
    copied.mockReset();
    error.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  it("copies the daemon-host prompt without installing a provider or skill", async () => {
    getPrompt.mockResolvedValue({ prompt: "Read C:\\host\\guide\\SKILL.md", error: null });
    writeText.mockResolvedValue(true);
    act(() => root?.render(<AcpOnboardingCopyPrompt serverId="server-1" />));
    const button = container?.querySelector("button");
    expect(button?.textContent).toContain("settings.providers.acpOnboarding.copyPrompt");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getPrompt).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Read C:\\host\\guide\\SKILL.md");
    expect(copied).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("reports clipboard false/throw and allows a later successful retry", async () => {
    getPrompt.mockResolvedValue({ prompt: "host prompt", error: null });
    writeText
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("clipboard denied"))
      .mockResolvedValueOnce(true);
    act(() => root?.render(<AcpOnboardingCopyPrompt serverId="server-1" />));
    const click = async () => {
      await act(async () => {
        container
          ?.querySelector("button")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    await click();
    await click();
    expect(error).toHaveBeenNthCalledWith(1, "settings.providers.acpOnboarding.copyFailed");
    expect(error).toHaveBeenNthCalledWith(2, "clipboard denied");
    expect(copied).not.toHaveBeenCalled();
    await click();
    expect(getPrompt).toHaveBeenCalledTimes(3);
    expect(copied).toHaveBeenCalledTimes(1);
  });

  it("surfaces daemon errors and never writes an empty prompt", async () => {
    getPrompt.mockResolvedValue({ prompt: null, error: "resource unavailable" });
    act(() => root?.render(<AcpOnboardingCopyPrompt serverId="server-1" />));
    await act(async () => {
      container?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("resource unavailable");
  });
});
