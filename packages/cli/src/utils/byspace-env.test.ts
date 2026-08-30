import { describe, expect, it } from "vitest";
import { applyByspaceEnvironment } from "./byspace-env.js";

describe("applyByspaceEnvironment", () => {
  it("maps BYSPACE variables to internal PASEO names", () => {
    const env = {
      BYSPACE_AGENT_ID: "agent-new",
      PASEO_AGENT_ID: "agent-legacy",
    };

    applyByspaceEnvironment(env);

    expect(env).toMatchObject({
      BYSPACE_AGENT_ID: "agent-new",
      PASEO_AGENT_ID: "agent-new",
    });
  });

  it("retains legacy variables when no BYSPACE alias is set", () => {
    const env = { PASEO_AGENT_ID: "agent-legacy" };

    applyByspaceEnvironment(env);

    expect(env.PASEO_AGENT_ID).toBe("agent-legacy");
  });
});
