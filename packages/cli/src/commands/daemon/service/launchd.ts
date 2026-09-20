import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DaemonServiceSpec } from "./service-spec.js";
import { launchdPlistPath } from "./service-spec.js";

/**
 * Render the launchd plist XML for the spec. KeepAlive is deliberately false: the
 * supervisor already restarts crashed workers, and launchd KeepAlive would resurrect
 * the daemon right after `byspace daemon stop`, breaking stop semantics. RunAtLoad
 * provides the "start at login" behavior.
 */
export function renderLaunchdPlist(spec: DaemonServiceSpec): string {
  const programArgs = [spec.nodePath, spec.runnerEntry, ...spec.runnerArgs];
  const args = programArgs
    .map((a) => `<string>${escapeXml(a)}</string>`)
    .map((s) => `    ${s}`)
    .join("\n");
  const envEntries = Object.entries(spec.env)
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(spec.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(spec.logPath)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function launchctl(args: string[], input?: string): { ok: boolean; output: string } {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
    input,
    timeout: 15_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

/** Write the plist and load it with `launchctl bootstrap gui/<uid>`. */
export function installLaunchdService(spec: DaemonServiceSpec, home: string): void {
  const plistPath = launchdPlistPath(spec.label, home);
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, renderLaunchdPlist(spec), { mode: 0o644 });

  const uid =
    process.getuid?.() ??
    (() => {
      throw new Error("cannot resolve uid");
    })();
  // bootout first so re-installing over a loaded service is idempotent.
  launchctl(["bootout", `gui/${uid}/${spec.label}`]);
  const boot = launchctl(["bootstrap", `gui/${String(uid)}`, plistPath]);
  if (!boot.ok) {
    throw new Error(`launchctl bootstrap failed: ${boot.output}`);
  }
}

/** Unload and delete the plist. Idempotent: succeeds when nothing is installed. */
export function uninstallLaunchdService(label: string, home: string): void {
  const uid =
    process.getuid?.() ??
    (() => {
      throw new Error("cannot resolve uid");
    })();
  launchctl(["bootout", `gui/${uid}/${label}`]);
  const plistPath = launchdPlistPath(label, home);
  rmSync(plistPath, { force: true });
}

/** Query the pid launchd reports for the label, or null when not loaded. */
export function launchdServicePid(label: string): number | null {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const { ok, output } = launchctl(["print", `gui/${uid}/${label}`]);
  if (!ok) return null;
  const match = output.match(/^\s*pid\s*=\s*(\d+)/m);
  return match ? Number(match[1]) : null;
}
