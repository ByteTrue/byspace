import type { Command } from "commander";
import { isCompleteGitRemote } from "@bytetrue/byspace-protocol/git-remote";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../utils/client.js";
import type { CommandError, OutputSchema, SingleResult } from "../output/index.js";
import type { CommandOptions } from "../output/with-output.js";

type CloneProtocol = "https" | "ssh";

interface CloneCommandOptions extends CommandOptions {
  protocol?: CloneProtocol;
}

export interface CloneResult {
  repo: string;
  checkoutPath: string;
  projectId: string;
  projectName: string;
}

export const cloneSchema: OutputSchema<CloneResult> = {
  idField: "projectId",
  columns: [
    { header: "REPO", field: "repo", width: 28 },
    { header: "PROJECT", field: "projectName", width: 28 },
    { header: "PATH", field: "checkoutPath", width: 56 },
  ],
};

function cmdError(code: string, message: string, details?: string): CommandError {
  return details ? { code, message, details } : { code, message };
}

async function cloneGithubProjectCompat(
  client: DaemonClient,
  input: { repo: string; targetDirectory: string; cloneProtocol?: CloneProtocol },
  useLegacyClone: boolean,
): Promise<CloneResult> {
  const response = useLegacyClone
    ? await client.cloneGithubWorkspace(input)
    : await client.cloneGithubProject(input);
  let projectId: string | null = null;
  let projectName: string | null = null;
  if ("project" in response && response.project) {
    projectId = response.project.projectId;
    projectName = response.project.projectDisplayName;
  } else if ("workspace" in response && response.workspace) {
    projectId = response.workspace.projectId;
    projectName = response.workspace.projectDisplayName;
  }
  if (response.error || !projectId || !projectName || !response.checkoutPath) {
    throw cmdError(
      "CLONE_FAILED",
      `Failed to clone GitHub repo: ${response.error ?? "no project returned"}`,
    );
  }
  return {
    repo: response.repo,
    checkoutPath: response.checkoutPath,
    projectId,
    projectName,
  };
}

export async function runCloneCommand(
  repo: string,
  options: CloneCommandOptions,
  _command: Command,
): Promise<SingleResult<CloneResult>> {
  const targetDirectory = typeof options.dir === "string" ? options.dir.trim() : "";
  if (!targetDirectory) {
    throw cmdError("INVALID_ARGUMENT", "--dir is required");
  }
  const repoIsCompleteRemote = isCompleteGitRemote(repo);
  if (!repoIsCompleteRemote && !options.protocol) {
    throw cmdError("INVALID_ARGUMENT", "--protocol is required for owner/repo repository names");
  }

  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (err) {
    throw buildDaemonConnectionCommandError({ host: options.host, error: err });
  }

  const features = client.getLastServerInfoMessage()?.features;
  const useLegacyClone =
    features?.projectGithubClone !== true && features?.workspaceGithubClone === true;
  if (features?.projectGithubClone !== true && !useLegacyClone) {
    await client.close().catch(() => {});
    throw cmdError(
      "UNSUPPORTED_BY_HOST",
      "This daemon does not support cloning GitHub repos.",
      "Update the host to a newer BySpace version.",
    );
  }

  try {
    const data = await cloneGithubProjectCompat(
      client,
      {
        repo,
        targetDirectory,
        ...(repoIsCompleteRemote ? {} : { cloneProtocol: options.protocol }),
      },
      useLegacyClone,
    );
    return { type: "single", data, schema: cloneSchema };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw cmdError("CLONE_FAILED", `Failed to clone GitHub repo: ${message}`);
  } finally {
    await client.close().catch(() => {});
  }
}
