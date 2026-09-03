import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFileKnownHostsStore,
  sshHostKeyFingerprint,
  sshKnownHostsKey,
  verifySshHostKey,
} from "./ssh-known-hosts";

describe("sshKnownHostsKey", () => {
  it("uses the bare host on the default SSH port", () => {
    expect(sshKnownHostsKey({ host: "build-box" })).toBe("build-box");
  });

  it("brackets the host when a custom SSH port is set", () => {
    expect(sshKnownHostsKey({ host: "build-box", sshPort: 2222 })).toBe("[build-box]:2222");
  });

  it("rejects a blank host", () => {
    expect(() => sshKnownHostsKey({ host: "  " })).toThrow("SSH host is required");
  });
});

describe("sshHostKeyFingerprint", () => {
  it("matches the OpenSSH SHA256 fingerprint format without padding", () => {
    const hostKey = Buffer.from("host-key-bytes");
    const expected = `SHA256:${createHash("sha256").update(hostKey).digest("base64").replace(/=+$/u, "")}`;
    expect(sshHostKeyFingerprint(hostKey)).toBe(expected);
  });
});

describe("verifySshHostKey", () => {
  it("pins an unknown host on first use", () => {
    expect(verifySshHostKey({ knownHostsKey: "build-box", fingerprint: "SHA256:abc" }, {})).toEqual(
      { action: "accept-and-pin", fingerprint: "SHA256:abc" },
    );
  });

  it("accepts a host whose fingerprint matches the pin", () => {
    expect(
      verifySshHostKey(
        { knownHostsKey: "build-box", fingerprint: "SHA256:abc" },
        { "build-box": "SHA256:abc" },
      ),
    ).toEqual({ action: "accept", fingerprint: "SHA256:abc" });
  });

  it("rejects a host whose fingerprint changed", () => {
    expect(
      verifySshHostKey(
        { knownHostsKey: "build-box", fingerprint: "SHA256:new" },
        { "build-box": "SHA256:old" },
      ),
    ).toEqual({ action: "reject", fingerprint: "SHA256:new", pinnedFingerprint: "SHA256:old" });
  });
});

describe("createFileKnownHostsStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "byspace-known-hosts-"));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty pin set when the file is missing", async () => {
    const store = createFileKnownHostsStore(join(dir, "missing"));
    await expect(store.load()).resolves.toEqual({});
  });

  it("round-trips pins and ignores malformed entries", async () => {
    const userDataPath = join(dir, "profile");
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(
      join(userDataPath, "remote-ssh-known-hosts.json"),
      JSON.stringify({ "good-host": "SHA256:abc", "bad-host": 42, malformed: null }),
    );
    const store = createFileKnownHostsStore(userDataPath);
    expect(await store.load()).toEqual({ "good-host": "SHA256:abc" });

    await store.save({ "good-host": "SHA256:abc", "other-host": "SHA256:def" });
    expect(await store.load()).toEqual({
      "good-host": "SHA256:abc",
      "other-host": "SHA256:def",
    });
  });
});
