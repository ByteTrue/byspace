import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveDaemonPassword } from "./client.js";

afterEach(() => vi.unstubAllEnvs());

describe("resolveDaemonPassword", () => {
  test("ignores the restricted CLI token for ordinary commands", () => {
    vi.stubEnv("BYSPACE_CLI_TOKEN", "restricted-token");
    vi.stubEnv("BYSPACE_PASSWORD", "");

    expect(resolveDaemonPassword("localhost:6777")).toBeUndefined();
  });

  test("prefers the restricted CLI token for orchestration commands", () => {
    vi.stubEnv("BYSPACE_CLI_TOKEN", "restricted-token");
    vi.stubEnv("BYSPACE_PASSWORD", "operator-password");

    expect(resolveDaemonPassword("localhost:6777", { useAgentCliToken: true })).toBe(
      "restricted-token",
    );
  });
});
