import { useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import type { ProjectIcon } from "@bytetrue/byspace-protocol/messages";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import {
  resolveProjectIconLookup,
  type ProjectIconRequestTarget,
} from "@/projects/project-icon-lookup";

export type { ProjectIconRequestTarget } from "@/projects/project-icon-lookup";

function iconDataUri(icon: ProjectIcon | null): string | null {
  return icon ? `data:${icon.mimeType};base64,${icon.data}` : null;
}

function useStableIconData(data: (string | null)[], signature: string) {
  const stableRef = useRef<{ signature: string; data: (string | null)[] } | null>(null);
  if (stableRef.current?.signature !== signature) stableRef.current = { signature, data };
  return stableRef.current.data;
}

export function useProjectIconDataByProjectKey(input: {
  projects: readonly ProjectIconRequestTarget[];
}): Map<string, string | null> {
  const serverIds = useMemo(
    () => [...new Set(input.projects.map((project) => project.serverId))],
    [input.projects],
  );
  const supportsCustomIcons = useHostFeatureMap(serverIds, "projectCustomIcon");
  const requests = useMemo(() => {
    const unique = new Map<string, ProjectIconRequestTarget>();
    for (const project of input.projects) {
      const lookup = resolveProjectIconLookup(
        project,
        supportsCustomIcons.get(project.serverId) === true,
      );
      const key =
        lookup.kind === "project"
          ? `${project.serverId}:project:${lookup.projectId}`
          : `${project.serverId}:cwd:${lookup.cwd}`;
      unique.set(key, project);
    }
    return Array.from(unique.values());
  }, [input.projects, supportsCustomIcons]);

  const queries = useQueries({
    queries: requests.map((request) => {
      const lookup = resolveProjectIconLookup(
        request,
        supportsCustomIcons.get(request.serverId) === true,
      );
      return {
        queryKey:
          lookup.kind === "project"
            ? [
                "projectIcon",
                request.serverId,
                lookup.projectId,
                request.customIconRevision ?? "automatic",
              ]
            : ["projectIcon", request.serverId, "legacy", lookup.cwd],
        queryFn: async () => {
          const client = getHostRuntimeStore().getClient(request.serverId);
          if (!client) return null;
          const result =
            lookup.kind === "project"
              ? await client.getProjectIcon(lookup.projectId)
              : await client.requestProjectIcon(lookup.cwd);
          return result.icon;
        },
        select: iconDataUri,
        enabled: Boolean(
          getHostRuntimeStore().getClient(request.serverId) &&
          isHostRuntimeConnected(getHostRuntimeStore().getSnapshot(request.serverId)),
        ),
        staleTime: Infinity,
        gcTime: 1000 * 60 * 60,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      };
    }),
  });

  const signature = queries.map((query) => query.data ?? "").join("\u0000");
  const data = useStableIconData(
    queries.map((query) => query.data ?? null),
    signature,
  );

  return useMemo(() => {
    const byRequest = new Map<ProjectIconRequestTarget, string | null>();
    requests.forEach((request, index) => byRequest.set(request, data[index] ?? null));
    const result = new Map<string, string | null>();
    for (const project of input.projects) {
      const request = requests.find((candidate) => {
        const left = resolveProjectIconLookup(
          project,
          supportsCustomIcons.get(project.serverId) === true,
        );
        const right = resolveProjectIconLookup(
          candidate,
          supportsCustomIcons.get(candidate.serverId) === true,
        );
        return (
          project.serverId === candidate.serverId && JSON.stringify(left) === JSON.stringify(right)
        );
      });
      result.set(project.projectKey, request ? (byRequest.get(request) ?? null) : null);
    }
    return result;
  }, [data, input.projects, requests, supportsCustomIcons]);
}
