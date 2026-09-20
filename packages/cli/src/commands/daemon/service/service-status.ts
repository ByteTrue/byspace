import { existsSync } from "node:fs";
import { launchdPlistExists } from "./service-spec.js";
import { launchdServicePid } from "./launchd.js";

/**
 * Service management state. Deliberately distinct from "is a daemon running": the
 * service definition can exist while the daemon runs from a terminal instead, and a
 * stale plist can exist with nothing behind it. Report what is verifiable; the UI must
 * not claim "managed" without the pid matching.
 */
export type DaemonServiceState =
  | "not-installed"
  | "installed-stopped"
  | "installed-running-not-this-process"
  | "managed-by-service"
  | "unknown";

export interface DaemonServiceStatus {
  state: DaemonServiceState;
  label: string;
  /** Pid launchd reports for the service, when loaded. */
  servicePid: number | null;
  /** Pid of the currently running process (the caller's own daemon pid). */
  currentPid: number | null;
}

export function resolveLaunchdServiceStatus(
  label: string,
  home: string,
  currentPid: number | null,
): DaemonServiceStatus {
  if (!launchdPlistExists(label, home)) {
    return { state: "not-installed", label, servicePid: null, currentPid };
  }
  const servicePid = launchdServicePid(label);
  if (servicePid === null) {
    return { state: "installed-stopped", label, servicePid: null, currentPid };
  }
  if (currentPid !== null && servicePid === currentPid) {
    return { state: "managed-by-service", label, servicePid, currentPid };
  }
  return { state: "installed-running-not-this-process", label, servicePid, currentPid };
}

/**
 * Guard for install: only a daemon running from the published npm global install may
 * register itself as a service, otherwise the service would point at a temporary
 * checkout (dev) or a container filesystem (Docker) and break on the next reboot.
 */
export function validateServiceInstallOrigin(options: {
  installOriginError: string | null;
  isDocker: boolean;
}): string | null {
  if (options.isDocker) {
    return "Registering a service is not supported inside Docker. Use the container runtime's restart policy instead.";
  }
  return options.installOriginError;
}

/** True when running inside a Docker container. */
export function isRunningInDocker(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}
