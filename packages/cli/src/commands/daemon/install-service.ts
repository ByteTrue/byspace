import type { Command } from "commander";
import { buildDaemonServiceSpec, launchdPlistPath } from "./service/service-spec.js";
import { installLaunchdService } from "./service/launchd.js";
import { isRunningInDocker, validateServiceInstallOrigin } from "./service/service-status.js";
import {
  validateDaemonInstallOrigin,
  daemonInstallOriginRuntime,
} from "@bytetrue/server/daemon-install-origin";
import { npmGlobalBySpaceCli, BYSPACE_CLI_PACKAGE } from "@bytetrue/server/npm-global-cli";
import { resolveLocalDaemonState, resolveDaemonRunnerEntry } from "./local-daemon.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

interface InstallServiceResult {
  action: "installed";
  label: string;
  plistPath: string;
  runnerEntry: string;
  nodePath: string;
  logPath: string;
  message: string;
}

const installServiceResultSchema: OutputSchema<InstallServiceResult> = {
  idField: "action",
  columns: [
    {
      header: "STATUS",
      field: "action",
      color: () => "green",
    },
    { header: "LABEL", field: "label" },
    { header: "PLIST", field: "plistPath" },
    { header: "RUNNER", field: "runnerEntry" },
    { header: "MESSAGE", field: "message" },
  ],
};

export type InstallServiceCommandResult = SingleResult<InstallServiceResult>;

export async function runInstallServiceCommand(
  options: CommandOptions,
  _command: Command,
): Promise<InstallServiceCommandResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const state = resolveLocalDaemonState({ home });

  try {
    const dockerError = validateServiceInstallOrigin({
      installOriginError: null,
      isDocker: isRunningInDocker(),
    });
    if (dockerError) throw new Error(dockerError);

    const install = await npmGlobalBySpaceCli.inspect();
    const originError = validateServiceInstallOrigin({
      installOriginError: validateDaemonInstallOrigin(
        install,
        install.version,
        daemonInstallOriginRuntime,
      ),
      isDocker: false,
    });
    if (originError) throw new Error(originError);

    const spec = buildDaemonServiceSpec({
      home: state.home,
      logPath: state.logPath,
      runnerEntry: resolveDaemonRunnerEntry(),
      env: process.env,
    });
    installLaunchdService(spec, state.home);

    return {
      type: "single",
      data: {
        action: "installed",
        label: spec.label,
        plistPath: launchdPlistPath(spec.label, state.home),
        runnerEntry: spec.runnerEntry,
        nodePath: spec.nodePath,
        logPath: spec.logPath,
        message: `Registered ${spec.label}; the daemon starts at login and survives terminal exit.`,
      },
      schema: installServiceResultSchema,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "INSTALL_SERVICE_FAILED",
      message: `Failed to install the daemon service: ${message}`,
      details: `Only daemons running from the npm global ${BYSPACE_CLI_PACKAGE} install can be registered as a service.`,
    };
    throw error;
  }
}
