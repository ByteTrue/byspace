import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentSkillsSaveSelectionRequestSchema,
  MutableDaemonConfigSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("agent skills protocol", () => {
  it("parses dotted selection requests and confirmation", () => {
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-1",
        selection: { mode: "custom", skills: ["byspace"] },
        confirmedRemovals: ["byspace-loop"],
      }),
    ).toMatchObject({ requestId: "request-1" });
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.skills.get_status.request",
        requestId: "request-2",
      }).success,
    ).toBe(true);
  });

  it("parses status responses and keeps the capability optional", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "agent.skills.get_status.response",
        payload: {
          requestId: "request-3",
          state: "not-installed",
          ops: [{ kind: "add", name: "byspace" }],
          available: ["byspace"],
          installed: [],
          selection: { mode: "all" },
        },
      }).success,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-daemon",
        features: {},
      }).features.skillManagement,
    ).toBeUndefined();
  });

  it("keeps selectionSaved optional so an older daemon still parses", () => {
    const status = {
      type: "agent.skills.get_status.response",
      payload: {
        requestId: "request-4",
        state: "not-installed",
        ops: [],
        available: ["byspace"],
        installed: [],
        selection: { mode: "custom", skills: ["byspace"] },
        selectionSaved: false,
      },
    };

    expect(SessionOutboundMessageSchema.parse(status).payload).toMatchObject({
      selectionSaved: false,
    });
    const withoutField = { ...status, payload: { ...status.payload } };
    delete (withoutField.payload as { selectionSaved?: boolean }).selectionSaved;
    expect(SessionOutboundMessageSchema.safeParse(withoutField).success).toBe(true);
  });

  it("carries install targets as an optional field on both directions", () => {
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-5",
        selection: { mode: "all" },
        targets: ["agents"],
      }),
    ).toMatchObject({ targets: ["agents"] });
    // An app that predates targets omits them, and the daemon keeps what it has.
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-6",
        selection: { mode: "all" },
      }).targets,
    ).toBeUndefined();
  });

  it("follows the active-turn behavior when a save_selection response arrives", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "agent.skills.save_selection.response",
      payload: {
        requestId: "request-7",
        state: "up-to-date",
        ops: [],
        available: ["byspace"],
        installed: ["byspace"],
        selection: { mode: "all" },
        selectionSaved: true,
        targets: { available: ["agents", "claude"], selected: ["claude"] },
        confirmationRequired: null,
      },
    });

    expect(parsed.type).toBe("agent.skills.save_selection.response");
    expect("payload" in parsed).toBe(true);
  });

  it("keeps targets out of the strict skills object so an old client still parses config", () => {
    // Every shipped client parses `skills` with `.strict()`. A nested field would
    // make it reject the whole daemon-config message, so the field is top-level.
    expect(Object.keys(MutableDaemonConfigSchema.shape)).toContain("skillTargets");
    const skillsShape = MutableDaemonConfigSchema.shape.skills;
    expect(Object.keys(skillsShape.unwrap().shape)).toEqual(["selection"]);

    const oldClientShape = z
      .object({ skills: z.object({ selection: z.unknown().optional() }).strict().optional() })
      .passthrough();
    expect(
      oldClientShape.safeParse({
        skills: { selection: { mode: "all" } },
        skillTargets: ["agents"],
      }).success,
    ).toBe(true);
    expect(
      oldClientShape.safeParse({ skills: { selection: { mode: "all" }, targets: ["agents"] } })
        .success,
    ).toBe(false);
  });

  it("advertises target selection as a capability an older daemon omits", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "new-daemon",
        features: { skillManagement: true, skillInstallTargets: true },
      }).features.skillInstallTargets,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-daemon",
        features: { skillManagement: true },
      }).features.skillInstallTargets,
    ).toBeUndefined();
  });

  it("keeps targets optional on the status so an older daemon still parses", () => {
    const status = {
      type: "agent.skills.get_status.response",
      payload: {
        requestId: "request-8",
        state: "not-installed",
        ops: [],
        available: ["byspace"],
        installed: [],
        selection: { mode: "all" },
        selectionSaved: true,
      },
    };

    // Absence is the compat signal: the picker hides its location rows rather
    // than needing a separate capability flag.
    expect(SessionOutboundMessageSchema.parse(status).payload.targets).toBeUndefined();
  });
});
