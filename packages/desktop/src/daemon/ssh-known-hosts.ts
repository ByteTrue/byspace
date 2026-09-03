import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Trust-On-First-Use host key pinning for password-authenticated Remote SSH
 * sessions. Password auth hands the credential to whatever answers the
 * connection, so the server fingerprint is recorded on first use and verified
 * on every later connect; a mismatch is treated as an active attack and fails
 * the connection.
 *
 * Key-path sessions (no password) keep using the system OpenSSH known_hosts.
 */

const KNOWN_HOSTS_FILENAME = "remote-ssh-known-hosts.json";

export interface KnownHostsStore {
  load(): Promise<Record<string, string>>;
  save(entries: Record<string, string>): Promise<void>;
}

export function createInMemoryKnownHostsStore(
  initial: Record<string, string> = {},
): KnownHostsStore {
  let entries: Record<string, string> = { ...initial };
  return {
    async load() {
      return { ...entries };
    },
    async save(next) {
      entries = { ...next };
    },
  };
}

export function createFileKnownHostsStore(userDataPath: string): KnownHostsStore {
  const filePath = join(userDataPath, KNOWN_HOSTS_FILENAME);
  return {
    async load() {
      try {
        const raw = readFileSync(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return {};
        }
        const entries: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === "string" && typeof value === "string") {
            entries[key] = value;
          }
        }
        return entries;
      } catch {
        return {};
      }
    },
    async save(entries) {
      mkdirSync(userDataPath, { recursive: true });
      const tempPath = `${filePath}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
      writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    },
  };
}

export function sshKnownHostsKey(input: { host: string; sshPort?: number }): string {
  const host = input.host.trim();
  if (!host) throw new Error("SSH host is required");
  return input.sshPort === undefined ? host : `[${host}]:${input.sshPort}`;
}

export function sshHostKeyFingerprint(hostKey: Buffer): string {
  return `SHA256:${createHash("sha256").update(hostKey).digest("base64").replace(/=+$/u, "")}`;
}

export type SshHostKeyVerification =
  | { action: "accept-and-pin"; fingerprint: string }
  | { action: "accept"; fingerprint: string }
  | { action: "reject"; fingerprint: string; pinnedFingerprint: string };

export function verifySshHostKey(
  input: { knownHostsKey: string; fingerprint: string },
  pinned: Record<string, string>,
): SshHostKeyVerification {
  const pinnedFingerprint = pinned[input.knownHostsKey];
  if (pinnedFingerprint === undefined) {
    return { action: "accept-and-pin", fingerprint: input.fingerprint };
  }
  if (pinnedFingerprint === input.fingerprint) {
    return { action: "accept", fingerprint: input.fingerprint };
  }
  return { action: "reject", fingerprint: input.fingerprint, pinnedFingerprint };
}
