import { describe, expect, test } from "vitest";
import { z } from "zod";

import { validateProviderOptions } from "./provider-options.js";
import { ClaudeProviderOptionsSchema } from "./providers/claude/options.js";
import { CodexProviderOptionsSchema } from "./providers/codex/options.js";
import { OpenCodeProviderOptionsSchema } from "./providers/opencode/options.js";

describe("provider-owned option schemas", () => {
  test("accepts Codex native workspace-write and network policy nesting", () => {
    expect(
      CodexProviderOptionsSchema.parse({
        approval_policy: "never",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/var/cache/npm"],
          network_access: false,
        },
        web_search: "disabled",
        features: {
          network_proxy: {
            enabled: true,
            domains: { "registry.npmjs.org": "allow", "*": "deny" },
          },
        },
      }),
    ).toMatchObject({
      sandbox_workspace_write: { writable_roots: ["/var/cache/npm"] },
    });
  });

  test("reports the exact invalid Codex option path", () => {
    expect(() =>
      validateProviderOptions("codex", CodexProviderOptionsSchema, {
        sandbox_workspace_write: { writable_roots: ["/tmp", 42] },
      }),
    ).toThrow("providerOptions.sandbox_workspace_write.writable_roots[1]");
  });

  test("accepts Claude permission and fail-closed sandbox settings", () => {
    expect(
      ClaudeProviderOptionsSchema.parse({
        allowedTools: ["Read"],
        disallowedTools: ["Bash(rm *)"],
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          filesystem: { denyRead: ["~/.ssh/**"] },
          network: {
            allowedDomains: ["api.anthropic.com"],
            allowLocalBinding: false,
            allowUnixSockets: ["/var/run/docker.sock"],
          },
        },
        settings: { permissions: { ask: ["Bash(*)"], deny: ["Edit(.env)"] } },
      }),
    ).toMatchObject({ sandbox: { enabled: true, failIfUnavailable: true } });
  });

  test("reports the exact invalid Claude option path", () => {
    expect(() =>
      validateProviderOptions("claude", ClaudeProviderOptionsSchema, {
        sandbox: { network: { allowLocalBinding: "yes" } },
      }),
    ).toThrow("providerOptions.sandbox.network.allowLocalBinding");
  });

  test("accepts OpenCode native permission patterns and external_directory", () => {
    expect(
      OpenCodeProviderOptionsSchema.parse({
        permission: {
          bash: { "*": "ask", "git status": "allow" },
          external_directory: { "*": "deny", "/var/cache/npm/**": "allow" },
        },
      }),
    ).toMatchObject({ permission: { bash: { "*": "ask" } } });
  });

  test("reports the exact invalid OpenCode option path", () => {
    expect(() =>
      validateProviderOptions("opencode", OpenCodeProviderOptionsSchema, {
        permission: { bash: { "git status": "sometimes" } },
      }),
    ).toThrow('providerOptions.permission.bash["git status"]');
  });

  test.each([
    ["codex", CodexProviderOptionsSchema, { cwd: "/tmp" }],
    ["claude", ClaudeProviderOptionsSchema, { hooks: {} }],
    ["opencode", OpenCodeProviderOptionsSchema, { mcp: {} }],
  ])("rejects BySpace-owned or executable %s keys", (provider, schema, options) => {
    expect(() => validateProviderOptions(provider, schema, options)).toThrow(
      `Invalid providerOptions for '${provider}'`,
    );
  });

  test("all schemas reject non-JSON values", () => {
    const unsafe = { permission: { bash: () => true } };
    expect(z.json().safeParse(unsafe).success).toBe(false);
    expect(OpenCodeProviderOptionsSchema.safeParse(unsafe).success).toBe(false);
  });
});
