import { describe, expect, test } from "vitest";

import {
  extractHttpBearerToken,
  extractWsBearerProtocol,
  extractWsBearerToken,
  hashDaemonPassword,
  isBearerTokenValidAsync,
  isAgentCliTokenValid,
  isBearerTokenValid,
  shouldBypassBearerAuth,
} from "./auth.js";

const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("daemon bearer validator", () => {
  test("allows any token when no password is configured", () => {
    expect(isBearerTokenValid({ password: undefined, token: null })).toBe(true);
    expect(isBearerTokenValid({ password: undefined, token: "anything" })).toBe(true);
  });

  test("accepts only the exact daemon-minted agent CLI token", () => {
    const auth = { agentCliToken: "agent-cli-secret" };
    expect(isAgentCliTokenValid(auth, "agent-cli-secret")).toBe(true);
    expect(isAgentCliTokenValid(auth, "wrong")).toBe(false);
    expect(isAgentCliTokenValid(auth, null)).toBe(false);
  });

  test("accepts the plaintext token against the bcrypt hash and rejects missing or wrong tokens", async () => {
    expect(
      await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "correct-password" }),
    ).toBe(true);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: null })).toBe(
      false,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "wrong" })).toBe(
      false,
    );
  });

  test("hashes a password into a bcrypt value", () => {
    const hash = hashDaemonPassword("correct-password");

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(isBearerTokenValid({ password: hash, token: "correct-password" })).toBe(true);
  });

  test("extracts HTTP bearer tokens", () => {
    expect(extractHttpBearerToken("Bearer secret")).toBe("secret");
    expect(extractHttpBearerToken("Basic secret")).toBeNull();
    expect(extractHttpBearerToken(undefined)).toBeNull();
  });

  test("extracts WebSocket byspace bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, byspace.bearer.secret.with.dots");

    expect(protocol).toBe("byspace.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
    expect(extractWsBearerToken("byspace.other.secret")).toBeNull();
  });

  test("bypasses bearer auth for preflight, liveness, and capability-token routes", () => {
    // Preflight is always bypassed regardless of path.
    expect(shouldBypassBearerAuth("OPTIONS", "/api/status")).toBe(true);
    // Unauthenticated liveness probe.
    expect(shouldBypassBearerAuth("GET", "/api/health")).toBe(true);
    // Guarded by its own single-use download token, not the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/files/download")).toBe(true);
    expect(shouldBypassBearerAuth("POST", "/mcp/agents")).toBe(false);
    // Everything else stays behind the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/status")).toBe(false);
    expect(shouldBypassBearerAuth("POST", "/api/files/upload")).toBe(false);
  });
});
