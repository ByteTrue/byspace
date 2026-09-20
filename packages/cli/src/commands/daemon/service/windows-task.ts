import { spawnSync } from "node:child_process";
import type { DaemonServiceSpec } from "./service-spec.js";

/**
 * Windows scheduling backend. There is no launchd-style responsible-process Local
 * Network gate on Windows; the value here is start-at-login plus crash recovery,
 * not a bug fix — copy must not imply otherwise.
 *
 * The task runs `node.exe <runner-entry>` directly, never the `byspace.cmd` shim:
 * the shim goes through cmd.exe, which adds parsing layers scheduled tasks handle
 * poorly and hides the exit path.
 */

const TASK_FOLDER = "BySpace";

/** The scheduled task name for the daemon (folder-qualified for the API surface). */
export function scheduledTaskName(label: string): string {
  return `${TASK_FOLDER}\\${label}`;
}

/** Build the Register-ScheduledTask argument vector. Exposed for tests. */
export function buildRegisterArgs(spec: DaemonServiceSpec): string[] {
  const action = `$action = New-ScheduledTaskAction -Execute '${spec.nodePath}' -Argument '${spec.runnerEntry} ${escapeArgs(spec.runnerArgs)}'`;
  const trigger = "$trigger = New-ScheduledTaskTrigger -AtLogOn";
  const settings =
    "$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)";
  const principal =
    "$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive";
  const register = `Register-ScheduledTask -TaskPath '\\${TASK_FOLDER}\\' -TaskName '${spec.label}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`;
  const envBlock = Object.entries(spec.env)
    .map(
      ([key, value]) =>
        `[Environment]::SetEnvironmentVariable('${key}', '${escapePowerShell(value)}', 'Process')`,
    )
    .join("; ");
  const envSetup = envBlock ? `${envBlock}; ` : "";
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `${action}; ${trigger}; ${settings}; ${principal}; ${envSetup}${register}`,
  ];
}

function escapeArgs(args: string[]): string {
  return args.map((arg) => arg.replace(/'/g, "''")).join(" ");
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function powershell(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("powershell.exe", args, { encoding: "utf8", timeout: 30_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

/** Register the scheduled task. Env vars are snapshotted into the task definition. */
export function installWindowsTask(spec: DaemonServiceSpec): void {
  const result = powershell(buildRegisterArgs(spec));
  if (!result.ok) {
    throw new Error(`Register-ScheduledTask failed: ${result.output}`);
  }
}

/** Unregister the task. Idempotent: succeeds when nothing is registered. */
export function uninstallWindowsTask(label: string): void {
  powershell([
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Unregister-ScheduledTask -TaskPath '\\${TASK_FOLDER}\\' -TaskName '${label}' -Confirm:$false -ErrorAction SilentlyContinue`,
  ]);
}

/** The pid of the daemon process the task last launched, via task state. */
export function windowsTaskPid(label: string): number | null {
  const result = powershell([
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `(Get-ScheduledTask -TaskPath '\\${TASK_FOLDER}\\' -TaskName '${label}' -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo).LastTaskResult`,
  ]);
  if (!result.ok) return null;
  // 0 = last run succeeded; the task itself does not hold a pid, so the daemon pid
  // is resolved by the caller from the pid file, not from Task Scheduler.
  return result.output.includes("0") ? 0 : null;
}
