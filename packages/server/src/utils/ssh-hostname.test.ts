import { describe, expect, it } from "vitest";
import { createSshHostnameResolver } from "./ssh-hostname.js";

describe("createSshHostnameResolver", () => {
  it("normalizes aliases and coalesces concurrent lookups", async () => {
    const calls: string[] = [];
    const resolver = createSshHostnameResolver({
      lookup: async (host) => {
        calls.push(host);
        return "github.com";
      },
    });

    await expect(
      Promise.all([resolver("Work.Example."), resolver("work.example")]),
    ).resolves.toEqual(["github.com", "github.com"]);
    expect(calls).toEqual(["work.example"]);
  });

  it("evicts the least recently used hostname after 512 entries", async () => {
    let calls = 0;
    const resolver = createSshHostnameResolver({
      lookup: async (host) => {
        calls += 1;
        return host;
      },
    });

    for (let index = 0; index < 513; index += 1) {
      await resolver(`host-${index}.example`);
    }
    await resolver("host-0.example");

    expect(calls).toBe(514);
  });
});
