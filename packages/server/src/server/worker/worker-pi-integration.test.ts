/**
 * End-to-end check for the pi seam: does a worker's assembled role actually
 * reach the system prompt the model will see?
 *
 * The unit tests in this directory assert that we build the right string. That
 * is not the same claim as "pi receives it", because pi appends the value
 * through an extension hook that this repo generates at launch. This test takes
 * a real shipped template, assembles it with the real code, passes the result
 * through the real generated extension, and asserts the role survives.
 *
 * It exists because the whole worker domain rests on this one hop. If pi ever
 * stops honouring `before_agent_start`, a worker would silently run as a
 * generic agent and nothing else in the suite would notice.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { PiRpcAgentClient } from "../agent/providers/pi/agent.js";
import { FakePi } from "../agent/providers/pi/test-utils/fake-pi.js";
import { buildWorkerSessionConfig } from "./worker-session-config.js";
import { loadWorkerTemplate, resolveWorkerTemplateRoot } from "./worker-template.js";

interface BySpaceExtensionListener {
  (event: {
    systemPrompt: string;
  }): Promise<{ systemPrompt?: string } | undefined> | { systemPrompt?: string } | undefined;
}

/** Runs the generated extension and returns what it hands back to pi. */
async function applyBySpaceExtension(
  extensionPath: string,
  systemPrompt: string,
): Promise<string | undefined> {
  const listeners = new Map<string, BySpaceExtensionListener>();
  const extension = (await import(pathToFileURL(extensionPath).href)) as {
    default: (piApi: {
      on: (event: string, listener: BySpaceExtensionListener) => void;
      registerCommand: () => void;
    }) => void;
  };
  extension.default({
    on: (event, listener) => listeners.set(event, listener),
    registerCommand: () => undefined,
  });
  const result = await listeners.get("before_agent_start")?.({ systemPrompt });
  return (result as { systemPrompt?: string } | undefined)?.systemPrompt;
}

describe("worker role prompt reaches pi", () => {
  it("appends a shipped role to pi's own system prompt", async () => {
    const template = await loadWorkerTemplate("frontend-developer", resolveWorkerTemplateRoot());
    const { config, rolePrompt } = buildWorkerSessionConfig({
      template,
      cwd: mkdtempSync(path.join(tmpdir(), "worker-e2e-")),
      taskPrompt: "Build the pricing table.",
    });

    const pi = new FakePi();
    const client = new PiRpcAgentClient({
      logger: pino({ level: "silent" }),
      runtime: pi,
    });

    const session = await client.createSession(config);
    try {
      const launch = pi.recordedLaunches[0];
      expect(launch).toBeDefined();
      expect(launch!.extensionPaths).toHaveLength(1);

      // pi's own discovered prompt stands in for the project instructions it
      // would read at launch.
      const effective = await applyBySpaceExtension(
        launch!.extensionPaths[0]!,
        "Pi project prompt",
      );

      expect(effective).toBeDefined();
      // pi's prompt survives, and the role is appended after it.
      expect(effective!.startsWith("Pi project prompt")).toBe(true);
      expect(effective).toContain(rolePrompt);
      expect(effective).toContain("Build the pricing table.");
      expect(effective!.indexOf("Pi project prompt")).toBeLessThan(effective!.indexOf(rolePrompt));
    } finally {
      await session.close();
    }
  });

  it("does not send a role for a session that has none", async () => {
    // Guards the inverse: a plain session must not gain worker framing. The
    // generated extension omits the hook entirely when no prompt is configured,
    // so pi keeps its own prompt untouched.
    const pi = new FakePi();
    const client = new PiRpcAgentClient({
      logger: pino({ level: "silent" }),
      runtime: pi,
    });

    const session = await client.createSession({ provider: "pi", cwd: "/tmp/plain" });
    try {
      const launch = pi.recordedLaunches[0]!;
      expect(launch.extensionPaths).toHaveLength(1);

      const listeners = new Map<string, (event: { systemPrompt: string }) => unknown>();
      const extension = (await import(pathToFileURL(launch.extensionPaths[0]!).href)) as {
        default: (piApi: {
          on: (event: string, listener: (event: { systemPrompt: string }) => unknown) => void;
          registerCommand: () => void;
        }) => void;
      };
      extension.default({
        on: (event, listener) => listeners.set(event, listener),
        registerCommand: () => undefined,
      });

      // No hook means nothing can rewrite pi's prompt.
      expect(listeners.has("before_agent_start")).toBe(false);
    } finally {
      await session.close();
    }
  });
});
