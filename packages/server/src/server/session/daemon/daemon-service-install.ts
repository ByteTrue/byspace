import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBySpaceHome } from "../../byspace-home.js";

/**
 * Server-side service install (issue 043). The daemon installs *itself*: it knows its
 * own node executable, runner entry, and environment. This deliberately does not
 * import the CLI's service layer — the server bundle cannot depend on the CLI, and
 * the CLI command covers the same ground from the outside.
 *
 * KeepAlive is false so `byspace daemon stop` stays a real stop.
 */

export interface ServerServiceSpec {
  label: string;
  nodePath: string;
  runnerEntry: string;
  logPath: string;
  env: Record<string, string>;
}

export function buildServerServiceSpec(home: string): ServerServiceSpec {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("BYSPACE_") && value !== undefined) env[key] = value;
  }
  env.PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return {
    label: "cc.cd.byspace.daemon",
    nodePath: process.execPath,
    // The running daemon knows its own entry: the supervisor entry resolved this
    // process. Use the daemon-worker path via the server package root.
    runnerEntry: resolveSelfRunnerEntry(),
    logPath: path.join(home, "daemon.log"),
    env,
  };
}

function resolveSelfRunnerEntry(): string {
  // Walk up from this module to the @bytetrue/server package root (name-checked, so
  // it works under both src/ (tsx) and dist/ (compiled) tree shapes), then locate the
  // supervisor entrypoint the way the CLI's resolveDaemonRunnerEntry does.
  const here = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  let packageRoot: string | null = null;
  for (let i = 0; i < 12; i += 1) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (parsed.name === "@bytetrue/server") {
        packageRoot = dir;
        break;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!packageRoot) {
    throw new Error("Unable to locate the @bytetrue/server package root from the daemon module");
  }
  const distRunner = path.join(packageRoot, "dist", "scripts", "supervisor-entrypoint.js");
  if (existsSync(distRunner)) return distRunner;
  const srcRunner = path.join(packageRoot, "scripts", "supervisor-entrypoint.ts");
  if (existsSync(srcRunner)) return srcRunner;
  throw new Error("Unable to locate the supervisor entrypoint in the server package");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLaunchdPlist(spec: ServerServiceSpec): string {
  const programArgs = [spec.nodePath, spec.runnerEntry];
  const args = programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
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

function launchctl(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("launchctl", args, { encoding: "utf8", timeout: 15_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

/** Write the plist and load it. The daemon exits after install; launchd takes over. */
export function installLaunchdServiceServer(spec: ServerServiceSpec): void {
  const home = resolveBySpaceHome();
  const plistPath = path.join(home, "Library", "LaunchAgents", `${spec.label}.plist`);
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, renderLaunchdPlist(spec), { mode: 0o644 });

  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("cannot resolve uid for launchctl bootstrap");
  launchctl(["bootout", `gui/${uid}/${spec.label}`]);
  const boot = launchctl(["bootstrap", `gui/${String(uid)}`, plistPath]);
  if (!boot.ok) {
    throw new Error(`launchctl bootstrap failed: ${boot.output}`);
  }
}

/** Stop and remove the service definition. The daemon keeps running until stopped. */
export function uninstallLaunchdServiceServer(label: string): void {
  const uid = process.getuid?.();
  if (uid !== undefined) {
    launchctl(["bootout", `gui/${uid}/${label}`]);
  }
  const home = resolveBySpaceHome();
  rmSync(path.join(home, "Library", "LaunchAgents", `${label}.plist`), { force: true });
}

export function installSystemdServiceServer(spec: ServerServiceSpec): void {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
  const unitPath = path.join(configHome, "systemd", "user", `${spec.label}.service`);
  mkdirSync(path.dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, renderSystemdUnit(spec), { mode: 0o644 });
  const run = (args: string[]) => {
    const result = spawnSync("systemctl", ["--user", ...args], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `systemctl --user ${args[0]} failed: ${result.stderr ?? result.stdout ?? ""}`,
      );
    }
  };
  run(["daemon-reload"]);
  run(["enable", "--now", `${spec.label}.service`]);
}

function renderSystemdUnit(spec: ServerServiceSpec): string {
  const execStart = [spec.nodePath, spec.runnerEntry]
    .map((part) => part.replace(/([\\"])/g, "\\$1"))
    .join(" ");
  const envLines = Object.entries(spec.env)
    .map(([key, value]) => `Environment="${key}=${value.replace(/([\\"])/g, "\\$1")}"`)
    .join("\n");
  return `# Generated by the BySpace daemon (install-service). Edits are overwritten on reinstall.
[Unit]
Description=BySpace daemon
After=network-online.target

[Service]
Type=exec
ExecStart=${execStart}
${envLines}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function uninstallSystemdServiceServer(label: string): void {
  const run = (args: string[]) => {
    spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 20_000 });
  };
  run(["disable", "--now", `${label}.service`]);
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
  rmSync(path.join(configHome, "systemd", "user", `${label}.service`), { force: true });
  run(["daemon-reload"]);
}

export function uninstallWindowsTaskServer(label: string): void {
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Unregister-ScheduledTask -TaskPath '\\BySpace\\' -TaskName '${label}' -Confirm:$false -ErrorAction SilentlyContinue`,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
}
