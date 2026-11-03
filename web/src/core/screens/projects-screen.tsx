// Port of archive/expo-app:packages/app/src/screens/projects-screen.tsx: a host's project list in settings; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/projects-screen.py; edit it directly.
import { useCallback, useMemo, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { isHomeProjectViewKey } from "@/chief/home-workspace";
import { ProjectIconView } from "@/components/project-icon-view";
import { Spinner } from "~/components/ui/spinner";
import { useProjects, type ProjectHostError } from "@/hooks/use-projects";
import { useProjectIcons } from "@/projects/icons";
import { createProjectIconTarget } from "@/projects/icon-target";
import { settingsStyles } from "@/styles/settings";
import { openProjectSettings } from "@/navigation/settings-navigation";
import type { ProjectHostEntry, ProjectSummary } from "@/utils/projects";

interface ProjectsScreenProps {
  serverId: string;
}

interface HostProject {
  project: ProjectSummary;
  host: ProjectHostEntry;
}

export default function ProjectsScreen({ serverId }: ProjectsScreenProps) {
  const { t } = useTranslation();
  const { projects, hostErrors, isLoading } = useProjects();
  const hostProjects = useMemo<HostProject[]>(
    () =>
      projects
        // The Chief project is the daemon's own Home: its settings screen offers default-host and
        // removal, neither of which means anything for a workspace the daemon re-creates on boot.
        // The sidebar row is disabled for the same reason; this is the other way in.
        .filter((project) => !isHomeProjectViewKey(project.viewKey))
        .flatMap((project) =>
          project.hosts
            .filter((host) => host.serverId === serverId)
            .map((host) => ({ project, host })),
        ),
    [projects, serverId],
  );
  const scopedErrors = useMemo(
    () => hostErrors.filter((error) => error.serverId === serverId),
    [hostErrors, serverId],
  );
  const iconTargets = useMemo(
    () =>
      hostProjects.flatMap(({ project, host }) => {
        const target = createProjectIconTarget({
          projectViewKey: project.viewKey,
          placement: { ...host, iconWorkingDir: host.repoRoot },
        });
        return target ? [target] : [];
      }),
    [hostProjects],
  );
  const iconDataByProjectViewKey = useProjectIcons({
    projects: iconTargets,
  });

  if (isLoading && hostProjects.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center p-6 text-muted-foreground"
        data-testid="projects-list"
      >
        <Spinner className="size-8" />
      </div>
    );
  }

  if (hostProjects.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="projects-list"
      >
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("sidebar.project.empty.title")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="projects-list">
      {scopedErrors.length > 0 ? <HostErrorsBanner errors={scopedErrors} /> : null}
      <div className={settingsStyles.card}>
        {hostProjects.map(({ project, host }, index) => (
          <ProjectRow
            key={host.projectId}
            project={project}
            host={host}
            isFirst={index === 0}
            iconDataUri={iconDataByProjectViewKey.get(project.viewKey) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function HostErrorsBanner({ errors }: { errors: ProjectHostError[] }) {
  const { t } = useTranslation();
  return (
    <div
      className="mb-3 flex flex-col gap-1 rounded-lg border p-3"
      data-testid="projects-host-errors"
    >
      {errors.map((error) => (
        <span key={error.serverId} className="text-xs leading-[normal] text-red-300">
          {t("settings.projectList.hostLoadFailed", {
            hostName: error.serverName,
            message: error.message,
          })}
        </span>
      ))}
    </div>
  );
}

interface ProjectRowProps {
  project: ProjectSummary;
  host: ProjectHostEntry;
  isFirst: boolean;
  iconDataUri: string | null;
}

function ProjectRow({ project, host, isFirst, iconDataUri }: ProjectRowProps) {
  const { t } = useTranslation();
  const { viewKey } = project;
  const { projectName } = host;
  const handleNavigate = useCallback(() => {
    openProjectSettings(host.serverId, host.projectId);
  }, [host.projectId, host.serverId]);

  return (
    <button
      type="button"
      className={cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "gap-3 text-left hover:bg-muted active:bg-(--surface-3)",
      )}
      onClick={handleNavigate}
      aria-label={t("settings.projectList.editProject", { projectName })}
      data-testid={`project-row-${viewKey}`}
    >
      <div className="flex min-w-0 flex-1 flex-row items-center gap-3">
        <div className="flex size-4 shrink-0 items-center justify-center">
          <ProjectRowIcon
            iconDataUri={iconDataUri}
            projectName={projectName}
            projectViewKey={viewKey}
          />
        </div>
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{projectName}</span>
      </div>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function ProjectRowIcon({
  iconDataUri,
  projectName,
  projectViewKey,
}: {
  iconDataUri: string | null;
  projectName: string;
  projectViewKey: string;
}) {
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";
  return (
    <ProjectIconView
      iconDataUri={iconDataUri}
      initial={initial}
      projectViewKey={projectViewKey}
      size={16}
      textStyle={ICON_FALLBACK_TEXT}
    />
  );
}

const ICON_FALLBACK_TEXT: CSSProperties = { fontSize: 12 };
