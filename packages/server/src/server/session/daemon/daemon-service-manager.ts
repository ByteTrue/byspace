import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { BYSPACE_CLI_PACKAGE } from "./npm-global-cli.js";
import path from "node:path";
import { validateDaemonInstallOrigin, daemonInstallOriginRuntime } from "./install-origin.js";

/**
 * Daemon-side OS service management (issue 043). The daemon manages its own service
 * registration because install requires the daemon's install-origin context — the
 * npm-global verification and the runner entry resolution live in this process.
 *
 * KeepAlive/Restart is deliberately not "always": `byspace daemon stop` must stay a
 * real stop. The supervisor's own crash-restart handles worker failures.
 */

export const DAEMON_SERVICE_LABEL = "cc.cd.byspace.daemon";

export type DaemonServiceState =
  | "not-installed"
  | "installed-stopped"
  | "installed-running-not-this-process"
  | "managed-by-service"
  | "unknown";

export interface DaemonServiceView {
  state: DaemonServiceState;
  label: string;
  /** Linux only: whether the user manager survives logout (systemd linger). */
  linger?: boolean;
}

interface ServiceManagerProbe {
  /** Pid the service manager reports for the label, null when not loaded. */
  servicePid(): number | null;
  /** Whether a service definition file exists. */
  definitionExists(): boolean;
  /** Extra view flags (e.g. linger on Linux). */
  viewFlags(): { linger?: boolean };
}

function launchdProbe(home: string): ServiceManagerProbe {
  const plistPath = path.join(home, "Library", "LaunchAgents", `${DAEMON_SERVICE_LABEL}.plist`);
  return {
    definitionExists: () => existsSync(plistPath),
    servicePid: () => {
      try {
        const uid = process.getuid?.();
        if (uid === undefined) return null;
        const output = execFileSync("launchctl", ["print", `gui/${uid}/${DAEMON_SERVICE_LABEL}`], {
          encoding: "utf8",
          timeout: 10_000,
        });
        const match = output.match(/^\s*pid\s*=\s*(\d+)/m);
        return match ? Number(match[1]) : null;
      } catch {
        return null;
      }
    },
    viewFlags: () => ({}),
  };
}

function systemdProbe(): ServiceManagerProbe {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
  const unitPath = path.join(configHome, "systemd", "user", `${DAEMON_SERVICE_LABEL}.service`);
  return {
    definitionExists: () => existsSync(unitPath),
    servicePid: () => {
      try {
        const output = execFileSync(
          "systemctl",
          ["--user", "show", `${DAEMON_SERVICE_LABEL}.service`, "--property", "MainPID"],
          { encoding: "utf8", timeout: 10_000 },
        );
        const match = output.match(/^MainPID=(\d+)$/m);
        const pid = match ? Number(match[1]) : 0;
        return pid > 0 ? pid : null;
      } catch {
        return null;
      }
    },
    viewFlags: () => {
      try {
        const output = execFileSync(
          "loginctl",
          ["show-user", process.env.USER ?? "", "--property", "Linger"],
          { encoding: "utf8", timeout: 10_000 },
        );
        return { linger: /Linger=yes/.test(output) };
      } catch {
        return {};
      }
    },
  };
}

function windowsProbe(): ServiceManagerProbe {
  return {
    definitionExists: () => {
      try {
        const output = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-ScheduledTask -TaskPath '\\BySpace\\' -TaskName '${DAEMON_SERVICE_LABEL}' -ErrorAction SilentlyContinue) -ne $null`,
          ],
          { encoding: "utf8", timeout: 15_000 },
        );
        return output.trim() === "True";
      } catch {
        return false;
      }
    },
    servicePid: () => null,
    viewFlags: () => ({}),
  };
}

function probeForPlatform(): ServiceManagerProbe | null {
  switch (process.platform) {
    case "darwin":
      return launchdProbe(resolveBySpaceHomeForService());
    case "linux":
      return systemdProbe();
    case "win32":
      return windowsProbe();
    default:
      return null;
  }
}

function resolveBySpaceHomeForService(): string {
  return process.env.BYSPACE_HOME ?? path.join(process.env.HOME ?? "", ".byspace");
}

/** Guard: only a daemon from the published npm global install may self-register. */
export function validateServiceOriginSync(): string | null {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
    return "Registering a service is not supported inside Docker. Use the container runtime's restart policy instead.";
  }
  // The npm -g listing is the authoritative origin: it proves the published install
  // exists on this host. validateDaemonInstallOrigin then checks that THIS daemon
  // process actually runs from it — a dev checkout parses fine but fails the
  // package-root containment check, which is exactly the guard that matters here.
  try {
    const npmPrefix = execFileSync("npm", ["prefix", "-g"], {
      encoding: "utf8",
      timeout: 15_000,
    }).trim();
    const packagePath = path.join(npmPrefix, "lib", "node_modules", "@bytetrue", "byspace");
    const pkgJsonPath = path.join(packagePath, "package.json");
    if (!existsSync(pkgJsonPath)) {
      return `${BYSPACE_CLI_PACKAGE} is not installed with npm -g on this host`;
    }
    const version =
      (JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: string }).version ?? "";
    const install = {
      version,
      packagePath,
      globalRootPath: npmPrefix,
      isLinked: false,
    };
    return validateDaemonInstallOrigin(
      install,
      process.env.npm_package_version ?? version,
      daemonInstallOriginRuntime,
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Query the current service view. Never caches: each call re-probes the manager. */
export function queryDaemonServiceView(): DaemonServiceView {
  const probe = probeForPlatform();
  if (!probe) {
    return { state: "unknown", label: DAEMON_SERVICE_LABEL };
  }
  if (!probe.definitionExists()) {
    return { state: "not-installed", label: DAEMON_SERVICE_LABEL, ...probe.viewFlags() };
  }
  const servicePid = probe.servicePid();
  if (servicePid === null) {
    return { state: "installed-stopped", label: DAEMON_SERVICE_LABEL, ...probe.viewFlags() };
  }
  if (servicePid === process.pid) {
    return { state: "managed-by-service", label: DAEMON_SERVICE_LABEL, ...probe.viewFlags() };
  }
  return {
    state: "installed-running-not-this-process",
    label: DAEMON_SERVICE_LABEL,
    ...probe.viewFlags(),
  };
}
