import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  backAddProjectPage,
  chooseAddProjectHost,
  currentAddProjectPage,
  moveAddProjectActiveIndex,
  moveAddProjectSelection,
  openAddProjectFlow,
  openDirectorySearchPage,
  openGithubLocationPage,
  openNewDirectoryNamePage,
  openNewDirectoryParentPage,
  setAddProjectActiveIndex,
  setAddProjectPageInput,
  setNewDirectoryName,
  type AddProjectHost,
} from "./model";
import {
  buildAddProjectMethods,
  buildCloneLocationOptions,
  buildManualGithubRepositoryChoices,
} from "./options";

const COPY: Record<string, string> = {
  "addProjectFlow.methods.directory.label": "Search for directory",
  "addProjectFlow.methods.directory.description": "Find a directory on {{host}}",
  "addProjectFlow.methods.browse.label": "Browse",
  "addProjectFlow.methods.browse.description": "Pick a local directory",
  "addProjectFlow.methods.github.label": "Clone from GitHub",
  "addProjectFlow.methods.github.update": "Update this host to clone GitHub repositories",
  "addProjectFlow.methods.github.search": "Search your GitHub repositories",
  "addProjectFlow.methods.github.enter": "Enter a repository URL or owner/repo",
  "addProjectFlow.methods.newDirectory.label": "New directory",
  "addProjectFlow.methods.newDirectory.description": "Create an empty project on {{host}}",
  "addProjectFlow.methods.newDirectory.update": "Update this host to create directories",
  "addProjectFlow.repository.url": "Repository URL",
  "addProjectFlow.repository.cloneVia": "Clone via {{protocol}}",
  "addProjectFlow.destination.parent": "Parent directory: {{parent}}",
  "addProjectFlow.destination.exists": "Already exists",
};
const t = ((key: string, values?: Record<string, string>) => {
  let result = COPY[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    result = result.replace(`{{${name}}}`, value);
  }
  return result;
}) as TFunction;

const HOST: AddProjectHost = {
  serverId: "host-1",
  label: "Local",
  canAddProject: true,
  canBrowse: true,
  canCloneGithubRepositories: true,
  canSearchGithubRepositories: true,
  canCreateDirectory: true,
};

describe("Add Project navigation", () => {
  it("skips a single connected host without adding it to history", () => {
    const state = openAddProjectFlow({ hosts: [HOST] });

    expect(currentAddProjectPage(state)).toEqual({
      kind: "method",
      hostId: "host-1",
      query: "",
      activeIndex: 0,
      error: null,
    });
    expect(backAddProjectPage(state)).toBeNull();
  });

  it("restores page input and selection after Back", () => {
    const secondHost = { ...HOST, serverId: "host-2", label: "Remote" };
    let state = openAddProjectFlow({ hosts: [HOST, secondHost] });
    state = setAddProjectPageInput(state, "rem");
    state = setAddProjectActiveIndex(state, 1);
    state = chooseAddProjectHost(state, secondHost.serverId);
    state = openDirectorySearchPage(state, secondHost.serverId);

    state = backAddProjectPage(state) ?? state;
    state = backAddProjectPage(state) ?? state;

    expect(currentAddProjectPage(state)).toEqual({
      kind: "host",
      query: "rem",
      activeIndex: 1,
      error: null,
    });
  });

  it("wraps keyboard selection in both directions", () => {
    expect(moveAddProjectActiveIndex(2, 3, "next")).toBe(0);
    expect(moveAddProjectActiveIndex(0, 3, "previous")).toBe(2);
    expect(moveAddProjectSelection(0, [true, false, true], "next")).toBe(2);
  });

  it("restores a directory name after returning to and reselecting its parent", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openNewDirectoryParentPage(state, HOST.serverId);
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");
    state = setNewDirectoryName(state, "command-center");
    state = backAddProjectPage(state) ?? state;
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "new-directory-name",
      parentPath: "~/dev",
      name: "command-center",
    });
  });

  it("restores the GitHub destination query and active parent when reopening a repository", () => {
    const repository = {
      id: "repo-1",
      nameWithOwner: "ByteTrue/byspace",
      cloneUrl: "git@github.com:ByteTrue/byspace.git",
      description: null,
      visibility: "public",
      updatedAt: null,
    };
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openGithubLocationPage(state, HOST.serverId, repository);
    state = setAddProjectPageInput(state, "~/dev");
    state = setAddProjectActiveIndex(state, 2);
    state = backAddProjectPage(state) ?? state;
    state = openGithubLocationPage(state, HOST.serverId, repository);

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "github-location",
      query: "~/dev",
      activeIndex: 2,
    });
  });
});

describe("Add Project options", () => {
  it("keeps host-upgrade methods discoverable while hiding local-only Browse", () => {
    expect(
      buildAddProjectMethods(
        {
          ...HOST,
          canBrowse: false,
          canCloneGithubRepositories: false,
          canSearchGithubRepositories: false,
          canCreateDirectory: false,
        },
        t,
      ),
    ).toEqual([
      {
        id: "directory-search",
        label: "Search for directory",
        description: "Find a directory on Local",
      },
      {
        id: "github",
        label: "Clone from GitHub",
        description: "Update this host to clone GitHub repositories",
        disabled: true,
      },
      {
        id: "new-directory",
        label: "New directory",
        description: "Update this host to create directories",
        disabled: true,
      },
    ]);
  });

  it("offers manual URL and protocol-specific owner/repo clone choices", () => {
    expect(buildManualGithubRepositoryChoices("git@github.com:ByteTrue/byspace.git", t)).toEqual([
      expect.objectContaining({
        id: "manual:git@github.com:ByteTrue/byspace.git",
        nameWithOwner: "ByteTrue/byspace",
        cloneUrl: "git@github.com:ByteTrue/byspace.git",
      }),
    ]);
    expect(buildManualGithubRepositoryChoices("ByteTrue/byspace", t)).toEqual([
      expect.objectContaining({ cloneProtocol: "https", cloneUrl: "ByteTrue/byspace" }),
      expect.objectContaining({ cloneProtocol: "ssh", cloneUrl: "ByteTrue/byspace" }),
    ]);
    expect(buildManualGithubRepositoryChoices("byspace", t)).toEqual([]);
  });

  it("shows final clone paths while retaining parent paths as values", () => {
    expect(
      buildCloneLocationOptions(
        {
          parents: ["~/dev", "~/workspace"],
          repositoryName: "byspace",
          existingPaths: ["~/workspace/byspace"],
        },
        t,
      ),
    ).toEqual([
      {
        id: "~/dev",
        path: "~/dev",
        displayPath: "~/dev/byspace",
        secondaryText: "Parent directory: ~/dev",
        disabled: false,
      },
      {
        id: "~/workspace",
        path: "~/workspace",
        displayPath: "~/workspace/byspace",
        secondaryText: "Already exists",
        disabled: true,
      },
    ]);
  });

  it("shows equivalent absolute-home and tilde destinations only once", () => {
    expect(
      buildCloneLocationOptions(
        {
          parents: ["/Users/moboudra/dev", "~/dev"],
          repositoryName: "dotfiles",
          existingPaths: [],
        },
        t,
      ),
    ).toEqual([
      {
        id: "/Users/moboudra/dev",
        path: "/Users/moboudra/dev",
        displayPath: "/Users/moboudra/dev/dotfiles",
        secondaryText: "Parent directory: /Users/moboudra/dev",
        disabled: false,
      },
    ]);
  });
});
