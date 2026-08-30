import { afterEach, describe, expect, it, vi } from "vitest";
import { isPaseoDictationDebugEnabled } from "./recordings-debug.js";

describe("isPaseoDictationDebugEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers BYSPACE_DICTATION_DEBUG over the legacy alias", () => {
    vi.stubEnv("BYSPACE_DICTATION_DEBUG", "false");
    vi.stubEnv("PASEO_DICTATION_DEBUG", "true");

    expect(isPaseoDictationDebugEnabled()).toBe(false);
  });

  it("accepts PASEO_DICTATION_DEBUG as a compatibility fallback", () => {
    vi.stubEnv("PASEO_DICTATION_DEBUG", "true");

    expect(isPaseoDictationDebugEnabled()).toBe(true);
  });
});
