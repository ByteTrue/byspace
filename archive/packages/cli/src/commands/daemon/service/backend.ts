import type { DaemonServiceSpec } from "./service-spec.js";

/**
 * Which service-manager backend applies on this host. The command layer dispatches
 * on this instead of scattering `process.platform` branches.
 */
export type ServiceBackend = "launchd" | "systemd" | "windows-task" | "unsupported";

export function resolveServiceBackend(
  platform: NodeJS.Platform = process.platform,
): ServiceBackend {
  switch (platform) {
    case "darwin":
      return "launchd";
    case "linux":
      return "systemd";
    case "win32":
      return "windows-task";
    default:
      return "unsupported";
  }
}

export interface ServiceBackendApi {
  install(spec: DaemonServiceSpec): void;
  uninstall(label: string): void;
  /** The pid the service manager reports, or null when not loaded/running. */
  servicePid(label: string): number | null;
}

/** Backend dispatch. Each module is imported lazily so unused platform code never loads. */
export function serviceBackend(backend: ServiceBackend): ServiceBackendApi {
  switch (backend) {
    case "launchd": {
      const launchd = require("./launchd.js") as typeof import("./launchd.js");
      return {
        install: (spec) => {
          const { resolveBySpaceHome } = require("@bytetrue/server") as {
            resolveBySpaceHome: (env?: NodeJS.ProcessEnv) => string;
          };
          launchd.installLaunchdService(spec, resolveBySpaceHome());
        },
        uninstall: (label) => {
          const { resolveBySpaceHome } = require("@bytetrue/server") as {
            resolveBySpaceHome: (env?: NodeJS.ProcessEnv) => string;
          };
          launchd.uninstallLaunchdService(label, resolveBySpaceHome());
        },
        servicePid: (label) => launchd.launchdServicePid(label),
      };
    }
    case "systemd": {
      const systemd = require("./systemd.js") as typeof import("./systemd.js");
      return {
        install: (spec) => systemd.installSystemdService(spec),
        uninstall: (label) => systemd.uninstallSystemdService(label),
        servicePid: (label) => systemd.systemdServicePid(label),
      };
    }
    case "windows-task": {
      const win = require("./windows-task.js") as typeof import("./windows-task.js");
      return {
        install: (spec) => win.installWindowsTask(spec),
        uninstall: (label) => win.uninstallWindowsTask(label),
        servicePid: () => null,
      };
    }
    default:
      throw new Error(
        "This platform has no supported service manager integration (expected macOS, Linux, or Windows).",
      );
  }
}
