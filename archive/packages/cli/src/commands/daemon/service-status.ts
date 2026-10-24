import type { Command } from "commander";
import { resolveLaunchdServiceStatus } from "./service/service-status.js";
import { resolveLocalDaemonState } from "./local-daemon.js";
import type { CommandOptions, SingleResult, OutputSchema } from "../../output/index.js";

interface ServiceStatusResult {
  state: string;
  label: string;
  servicePid: string;
  daemonPid: string;
  managedByThisProcess: string;
}

const serviceStatusResultSchema: OutputSchema<ServiceStatusResult> = {
  idField: "state",
  columns: [
    { header: "STATE", field: "state" },
    { header: "LABEL", field: "label" },
    { header: "SERVICE PID", field: "servicePid" },
    { header: "DAEMON PID", field: "daemonPid" },
    { header: "MANAGED", field: "managedByThisProcess" },
  ],
};

export type ServiceStatusCommandResult = SingleResult<ServiceStatusResult>;

const SERVICE_LABEL = "cc.cd.byspace.daemon";

export async function runServiceStatusCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ServiceStatusCommandResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const state = resolveLocalDaemonState({ home });
  const status = resolveLaunchdServiceStatus(SERVICE_LABEL, state.home, state.pidInfo?.pid ?? null);

  return {
    type: "single",
    data: {
      state: status.state,
      label: status.label,
      servicePid: status.servicePid === null ? "-" : String(status.servicePid),
      daemonPid: status.currentPid === null ? "-" : String(status.currentPid),
      managedByThisProcess: status.state === "managed-by-service" ? "yes" : "no",
    },
    schema: serviceStatusResultSchema,
  };
}
