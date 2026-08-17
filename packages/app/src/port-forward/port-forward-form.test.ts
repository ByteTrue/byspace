import { describe, expect, it } from "vitest";
import {
  createPortForwardDraft,
  preparePortForward,
  reconcilePortForwardDraft,
} from "./port-forward-form";

const hosts = [
  { serverId: "source", label: "Source" },
  { serverId: "target", label: "Target" },
  { serverId: "third", label: "Third" },
] as const;

describe("port forward form", () => {
  it("selects distinct hosts and leaves ports empty", () => {
    expect(createPortForwardDraft(hosts)).toEqual({
      sourceServerId: "source",
      targetServerId: "target",
      targetPort: "",
      localPort: "",
    });
  });

  it("reconciles removed and duplicate host selections", () => {
    expect(
      reconcilePortForwardDraft(
        {
          sourceServerId: "removed",
          targetServerId: "source",
          targetPort: "3000",
          localPort: "",
        },
        hosts,
      ),
    ).toEqual({
      sourceServerId: "source",
      targetServerId: "target",
      targetPort: "3000",
      localPort: "",
    });
  });

  it("prepares a forward with an automatic local port", () => {
    expect(
      preparePortForward({
        sourceServerId: "source",
        targetServerId: "target",
        targetPort: " 5173 ",
        localPort: "",
      }),
    ).toEqual({
      value: {
        sourceServerId: "source",
        targetServerId: "target",
        targetPort: 5173,
      },
      errors: {},
    });
  });

  it("prepares an explicit local port", () => {
    expect(
      preparePortForward({
        sourceServerId: "source",
        targetServerId: "target",
        targetPort: "443",
        localPort: "8443",
      }).value,
    ).toEqual({
      sourceServerId: "source",
      targetServerId: "target",
      targetPort: 443,
      localPort: 8443,
    });
  });

  it("rejects missing, duplicate, fractional, and out-of-range values", () => {
    expect(
      preparePortForward({
        sourceServerId: "source",
        targetServerId: "source",
        targetPort: "1.5",
        localPort: "65536",
      }),
    ).toEqual({
      value: null,
      errors: {
        targetServerId: "hosts-must-differ",
        targetPort: "invalid-port",
        localPort: "invalid-port",
      },
    });
  });
});
