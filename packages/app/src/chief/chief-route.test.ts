import { describe, expect, it } from "vitest";
import { isShowingChiefAgent } from "./chief-route";

const AGENT_ID = "48349b36-a99a-4515-84aa-1a54ff32fed8";
const SERVER = "srv_V-x1TZfswUin";
const WORKSPACE = "wks_e584865020c0bbdd";

function check(overrides: Partial<Parameters<typeof isShowingChiefAgent>[0]> = {}) {
  return isShowingChiefAgent({
    pathname: "/",
    openIntentParam: undefined,
    focusedAgentId: null,
    agentId: AGENT_ID,
    ...overrides,
  });
}

describe("isShowingChiefAgent", () => {
  it("recognizes the dedicated agent route", () => {
    expect(check({ pathname: `/h/${SERVER}/agent/${AGENT_ID}` })).toBe(true);
  });

  it("recognizes a workspace route opened onto the agent", () => {
    // Where the compact FAB navigates.
    expect(
      check({
        pathname: `/h/${SERVER}/workspace/${WORKSPACE}`,
        openIntentParam: `agent:${AGENT_ID}`,
      }),
    ).toBe(true);
  });

  it("keeps recognizing the agent after the route consumes the open intent", () => {
    // The workspace route strips ?open= from the URL once it has opened the tab.
    // The focused agent is what the intent settles into, and without it the
    // button came back on a phone, floating over the pane it should stay out of.
    expect(
      check({
        pathname: `/h/${SERVER}/workspace/${WORKSPACE}`,
        openIntentParam: undefined,
        focusedAgentId: AGENT_ID,
      }),
    ).toBe(true);
  });

  it("accepts a repeated query parameter", () => {
    expect(check({ openIntentParam: [`agent:${AGENT_ID}`, "agent:other"] })).toBe(true);
  });

  it("keeps the button on other workspace routes and other agents", () => {
    expect(check({ pathname: `/h/${SERVER}/workspace/${WORKSPACE}` })).toBe(false);
    expect(check({ openIntentParam: "agent:some-other-agent" })).toBe(false);
    expect(check({ openIntentParam: "terminal:term-1" })).toBe(false);
    // A different agent focused in the pane is not this one.
    expect(check({ focusedAgentId: "some-other-agent" })).toBe(false);
  });

  it("never suppresses without an agent id", () => {
    expect(
      check({
        pathname: `/h/${SERVER}/agent/${AGENT_ID}`,
        openIntentParam: `agent:${AGENT_ID}`,
        focusedAgentId: AGENT_ID,
        agentId: "",
      }),
    ).toBe(false);
  });
});
