import type { Command } from "commander";
import { uninstallLaunchdService } from "./service/launchd.js";
import { resolveLaunchdServiceStatus } from "./service/service-status.js";
import { resolveLocalDaemonState } from "./local-daemon.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

interface UninstallServiceResult {
  action: "uninstalled" | "not_installed";
  label: string;
  message: string;
}

const uninstallServiceResultSchema: OutputSchema<UninstallServiceResult> = {
  idField: "action",
  columns: [
    {
      header: "STATUS",
      field: "action",
      color: (value) => (value === "uninstalled" ? "green" : "yellow"),
    },
    { header: "LABEL", field: "label" },
    { header: "MESSAGE", field: "message" },
  ],
};

export type UninstallServiceCommandResult = SingleResult<UninstallServiceResult>;

const SERVICE_LABEL = "cc.cd.byspace.daemon";

export async function runUninstallServiceCommand(
  options: CommandOptions,
  _command: Command,
): Promise<UninstallServiceCommandResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const state = resolveLocalDaemonState({ home });

  try {
    const status = resolveLaunchdServiceStatus(
      SERVICE_LABEL,
      state.home,
      state.pidInfo?.pid ?? null,
    );
    if (status.state === "not-installed") {
      return {
        type: "single",
        data: {
          action: "not_installed",
          label: SERVICE_LABEL,
          message: "No daemon service is registered for this user.",
        },
        schema: uninstallServiceResultSchema,
      };
    }

    uninstallLaunchdService(SERVICE_LABEL, state.home);
    return {
      type: "single",
      data: {
        action: "uninstalled",
        label: SERVICE_LABEL,
        message: "The daemon service was unregistered and will no longer start at login.",
      },
      schema: uninstallServiceResultSchema,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "UNINSTALL_SERVICE_FAILED",
      message: `Failed to uninstall the daemon service: ${message}`,
    };
    throw error;
  }
}
