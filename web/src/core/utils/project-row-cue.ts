import { shortenPath } from "@/utils/shorten-path";

/**
 * How many host names a cue names before it gives up. Two is enough to make the pair of rows
 * distinguishable, and a third name would cost more width than the title it sits under.
 */
const MAX_NAMED_HOSTS = 2;

export interface ProjectRowCueSource {
  viewKey: string;
  projectName: string;
  hosts: readonly { serverId: string; iconWorkingDir: string }[];
}

/**
 * One line of "which one is this" for project rows whose names collide.
 *
 * Two projects that render the same name are two different things to the user — a directory
 * added on two machines, or the same repo tail on two forges. Nothing else on the row tells them
 * apart, so the cue names the host and the path, and only for the rows that actually collide: a
 * sidebar where nothing is ambiguous spends no width on this at all.
 *
 * Both halves are needed. A host name alone cannot separate `~/dev/chat` from `~/work/chat` on
 * one machine, and a path alone cannot separate `~/chat` on two — `shortenPath` turns both into
 * the same string.
 *
 * Keys are the collision set's `viewKey`s; projects with a unique name get no entry.
 */
export function buildProjectRowCues(input: {
  projects: readonly ProjectRowCueSource[];
  hostLabelByServerId: ReadonlyMap<string, string>;
}): Map<string, string> {
  const cues = new Map<string, string>();
  const viewKeysByDisplayName = new Map<string, string[]>();
  for (const project of input.projects) {
    const displayName = project.projectName.trim().toLocaleLowerCase();
    const viewKeys = viewKeysByDisplayName.get(displayName);
    if (viewKeys) {
      viewKeys.push(project.viewKey);
    } else {
      viewKeysByDisplayName.set(displayName, [project.viewKey]);
    }
  }

  const projectByViewKey = new Map(input.projects.map((project) => [project.viewKey, project]));
  for (const viewKeys of viewKeysByDisplayName.values()) {
    if (viewKeys.length < 2) continue;
    for (const viewKey of viewKeys) {
      const project = projectByViewKey.get(viewKey);
      if (!project) continue;
      const cue = formatProjectRowCue({ project, hostLabelByServerId: input.hostLabelByServerId });
      if (cue) cues.set(viewKey, cue);
    }
  }
  return cues;
}

function formatProjectRowCue(input: {
  project: ProjectRowCueSource;
  hostLabelByServerId: ReadonlyMap<string, string>;
}): string {
  const hostLabels = input.project.hosts.map(
    (host) => input.hostLabelByServerId.get(host.serverId)?.trim() || host.serverId,
  );
  const named = hostLabels.slice(0, MAX_NAMED_HOSTS).join(", ");
  const hostPart = hostLabels.length > MAX_NAMED_HOSTS ? `${named}…` : named;
  const pathPart = shortenPath(primaryHostPath(input.project));
  return [hostPart, pathPart].filter(Boolean).join(" · ");
}

function primaryHostPath(project: ProjectRowCueSource): string {
  return project.hosts.find((host) => host.iconWorkingDir.trim().length > 0)?.iconWorkingDir ?? "";
}

export interface ProjectRowPathLine {
  /** The host this line describes. Unique per project, so it is also the render key: two hosts
   * may share a label *and* a directory, and the rendered text cannot be told apart. */
  serverId: string;
  text: string;
}

/**
 * The complete answer behind the cue, for the row's hover tooltip: every host the project lives
 * on with its full path, because the cue is truncated on purpose and this is where the rest of
 * it lives.
 */
export function buildProjectRowPathLines(input: {
  project: ProjectRowCueSource;
  hostLabelByServerId: ReadonlyMap<string, string>;
}): ProjectRowPathLine[] {
  const lines = input.project.hosts.flatMap((host): ProjectRowPathLine[] => {
    const path = host.iconWorkingDir.trim();
    if (!path) return [];
    if (input.project.hosts.length === 1) return [{ serverId: host.serverId, text: path }];
    const label = input.hostLabelByServerId.get(host.serverId)?.trim() || host.serverId;
    return [{ serverId: host.serverId, text: `${label} · ${path}` }];
  });
  if (lines.length > 0) return lines;
  // No host carries a path, so the only thing left to name is the hosts themselves. One line for
  // the whole set, since a per-host line would be an empty string.
  const serverIds = input.project.hosts.map((host) => host.serverId).join(", ");
  return serverIds ? [{ serverId: input.project.hosts[0].serverId, text: serverIds }] : [];
}
