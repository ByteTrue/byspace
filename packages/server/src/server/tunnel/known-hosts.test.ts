import { describe, expect, it } from "vitest";
import {
  createFileKnownHostsStore,
  createInMemoryKnownHostsStore,
  sshHostKeyFingerprint,
  sshKnownHostsKey,
  verifySshHostKey,
} from "./known-hosts.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

describe("sshKnownHostsKey", () => {
  it("formats non-default ports in brackets", () => {
    expect(sshKnownHostsKey({ host: "example.com", sshPort: 2222 })).toBe("[example.com]:2222");
  });

  it("keeps bare hosts without brackets", () => {
    expect(sshKnownHostsKey({ host: "user@example.com" })).toBe("user@example.com");
  });

  it("rejects empty hosts", () => {
    expect(() => sshKnownHostsKey({ host: "  " })).toThrow();
  });
});

describe("sshHostKeyFingerprint", () => {
  it("produces an unpadded SHA256 base64 fingerprint", () => {
    const key = Buffer.from("test-host-key");
    const expected = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/u, "")}`;
    expect(sshHostKeyFingerprint(key)).toBe(expected);
    expect(sshHostKeyFingerprint(key)).not.toMatch(/=$/u);
  });
});

describe("verifySshHostKey", () => {
  const key = "example.com";

  it("asks to pin on first use", () => {
    expect(verifySshHostKey({ knownHostsKey: key, fingerprint: "fp1" }, {})).toEqual({
      action: "accept-and-pin",
      fingerprint: "fp1",
    });
  });

  it("accepts a pinned fingerprint", () => {
    expect(verifySshHostKey({ knownHostsKey: key, fingerprint: "fp1" }, { [key]: "fp1" })).toEqual({
      action: "accept",
      fingerprint: "fp1",
    });
  });

  it("rejects a changed fingerprint with the pinned value", () => {
    expect(verifySshHostKey({ knownHostsKey: key, fingerprint: "fp2" }, { [key]: "fp1" })).toEqual({
      action: "reject",
      fingerprint: "fp2",
      pinnedFingerprint: "fp1",
    });
  });
});

describe("createInMemoryKnownHostsStore", () => {
  it("round-trips entries", async () => {
    const store = createInMemoryKnownHostsStore({ a: "fp-a" });
    expect(await store.load()).toEqual({ a: "fp-a" });
    await store.save({ b: "fp-b" });
    expect(await store.load()).toEqual({ b: "fp-b" });
  });

  it("isolates copies on load", async () => {
    const store = createInMemoryKnownHostsStore({ a: "fp-a" });
    const first = await store.load();
    first.a = "mutated";
    expect(await store.load()).toEqual({ a: "fp-a" });
  });
});

describe("createFileKnownHostsStore", () => {
  it("persists entries under the byspace home and tolerates missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "byspace-known-hosts-"));
    try {
      const store = createFileKnownHostsStore(dir);
      expect(await store.load()).toEqual({});
      await store.save({ "example.com": "fp1" });
      const raw = JSON.parse(await readFile(join(dir, "tunnel-known-hosts.json"), "utf8"));
      expect(raw).toEqual({ "example.com": "fp1" });
      const store2 = createFileKnownHostsStore(dir);
      expect(await store2.load()).toEqual({ "example.com": "fp1" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for corrupt files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "byspace-known-hosts-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, "tunnel-known-hosts.json"), "not json", "utf8");
      const store = createFileKnownHostsStore(dir);
      expect(await store.load()).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
