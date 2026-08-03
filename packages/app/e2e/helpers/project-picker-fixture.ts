import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SeedDaemonClient } from "./seed-client";

export interface ProjectPickerFixture {
  projectPath: string;
  projectName: string;
  fuzzyQuery: string;
}

interface ProjectPickerFixtureResource {
  fixture: ProjectPickerFixture;
  removeDirectory: () => Promise<void>;
}

export async function createProjectPickerFixture(): Promise<ProjectPickerFixtureResource> {
  const root = await mkdtemp(path.join(homedir(), "byspace-e2e-project-picker-"));
  const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
  const projectPath = path.join(root, "client", "team", `byspace-desktop-fuzzy-target-${nonce}`);
  await mkdir(projectPath, { recursive: true });

  return {
    fixture: {
      projectPath,
      projectName: path.basename(projectPath),
      fuzzyQuery: `bsdfzt${nonce}`,
    },
    removeDirectory: () => rm(root, { recursive: true, force: true }),
  };
}

export async function removeProjectPickerFixture(
  client: SeedDaemonClient,
  fixture: ProjectPickerFixture,
  knownProjectId: string | null = null,
): Promise<void> {
  const listedProject = (await client.listProjects()).projects.find(
    (project) => project.projectRootPath === fixture.projectPath,
  );
  let projectId = listedProject?.projectId ?? knownProjectId;
  if (!listedProject && !projectId) {
    const lookup = await client.addProject(fixture.projectPath);
    projectId = lookup.project?.projectId ?? null;
    if (!projectId) {
      throw new Error(lookup.error ?? "Could not resolve project picker fixture for cleanup");
    }
  }
  if (!projectId) {
    throw new Error("Could not resolve project picker fixture for cleanup");
  }
  await client.removeProject(projectId);
}
