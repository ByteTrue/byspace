import { describe, expect, test } from "vitest";
import {
  buildSelfNodeCommand,
  createExternalCommandProcessEnv,
  createExternalProcessEnv,
  createBySpaceInternalEnv,
  resolveBySpaceNodeEnv,
} from "./byspace-env.js";

describe("byspace env contract", () => {
  const baseEnv = {
    NODE_ENV: "development",
    PATH: "/usr/bin",
    BYSPACE_AGENT_ID: "agent-123",
    BYSPACE_NODE_ENV: "production",
    BYSPACE_SUPERVISED: "1",
  };
  const runtimeControlEnvKeys = ["BYSPACE_NODE_ENV", "BYSPACE_SUPERVISED"] as const;

  test("builds internal daemon child env by preserving pass-through and control vars", () => {
    expect(createBySpaceInternalEnv(baseEnv)).toMatchObject(baseEnv);
  });

  test("builds external process env by scrubbing runtime control vars after overlays", () => {
    const env = createExternalProcessEnv(baseEnv, {
      EXTRA_VALUE: "from-overlay",
      BYSPACE_NODE_ENV: "test",
      BYSPACE_SUPERVISED: "1",
      PATH: "/custom/bin",
    });

    for (const key of runtimeControlEnvKeys) expect(env[key]).toBeUndefined();
    expect(env.NODE_ENV).toBe("development");
    expect(env.BYSPACE_AGENT_ID).toBe("agent-123");
    expect(env.PATH).toBe("/custom/bin");
  });

  test("applies non-control overlays to external process env", () => {
    const env = createExternalProcessEnv(baseEnv, { PATH: "/custom/bin" }, { CUSTOM: "value" });

    expect(env.CUSTOM).toBe("value");
    expect(env.NODE_ENV).toBe("development");
    expect(env.PATH).toBe("/custom/bin");
  });

  test("builds external command env without process.execPath special-casing", () => {
    const env = createExternalCommandProcessEnv(process.execPath, baseEnv, {
      BYSPACE_NODE_ENV: "test",
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.BYSPACE_AGENT_ID).toBe("agent-123");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.BYSPACE_NODE_ENV).toBeUndefined();
    expect(env.BYSPACE_SUPERVISED).toBeUndefined();
  });

  test("builds a self node command with external-safe environment", () => {
    const command = buildSelfNodeCommand(["script.js"], {
      CUSTOM: "value",
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual(["script.js"]);
    expect(command.env.CUSTOM).toBe("value");
    expect(command.env.BYSPACE_NODE_ENV).toBeUndefined();
    expect(command.env.BYSPACE_SUPERVISED).toBeUndefined();
  });

  test("does not use user NODE_ENV as BySpace runtime mode", () => {
    expect(resolveBySpaceNodeEnv({ NODE_ENV: "development" })).toBeUndefined();
    expect(resolveBySpaceNodeEnv({ NODE_ENV: "development", BYSPACE_NODE_ENV: "production" })).toBe(
      "production",
    );
    expect(resolveBySpaceNodeEnv({ NODE_ENV: "test", BYSPACE_NODE_ENV: "local" })).toBeUndefined();
  });
});
