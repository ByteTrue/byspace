import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { openNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  expectTerminalLaunchSelected,
  expectTerminalOutputContains,
  expectTerminalPreviewCommand,
  expectWorkspaceOpensWithTerminalTab,
  fillTerminalPrompt,
  seedTerminalProfiles,
  selectLaunchOption,
  submitTerminalLaunch,
  terminalLaunchSubmit,
  terminalPromptInput,
  type TerminalProfile,
  type TerminalProfileSeed,
} from "../support/helpers/new-workspace-launch";

// Someone who wants a terminal agent instead of a chat: they pick a profile
// from the meta-row control, type a prompt, and the daemon actually spawns the
// resolved command with their prompt substituted in — no mocking BySpace's own
// code, the "profile" here is a real, harmless binary the daemon really runs.
//
// Runs Node instead of `/bin/sh`, which does not exist on Windows (issue 078).
// The sentinel becomes a positional argument (never interpolated into the script
// source), so the prompt reaches the process exactly as typed with no injection
// risk. `argv[1]` is the prompt slot: with `-e`, argv is [node, ...args], and the
// sentinel arg is dropped when empty. A long timer replaces `exec cat`: the tests
// only read the printed line, and unlike a stdin pipe the timer keeps the process
// alive even when the PTY delivers no input.
const PROMPT_PROFILE: TerminalProfile = {
  id: "e2e-echo-prompt",
  name: "Echo Prompt",
  command: process.execPath,
  args: [
    "-e",
    'console.log("captured:", process.argv[1]); setTimeout(() => {}, 600_000);',
    "{{{prompt}}}",
  ],
};

// No sentinel anywhere: takes no prompt, composer goes read-only.
// Runs Node instead of `/bin/sh`, which does not exist on Windows (issue 078).
const BARE_PROFILE: TerminalProfile = {
  id: "e2e-echo-bare",
  name: "Bare Echo",
  command: process.execPath,
  args: ["-e", 'console.log("bare-launch-static-line"); setTimeout(() => {}, 600_000);'],
};

test.describe("New workspace: launching a terminal", () => {
  let workspace: SeededWorkspace;
  let profileSeed: TerminalProfileSeed;

  test.beforeEach(async () => {
    workspace = await seedWorkspace({ repoPrefix: "launch-terminal-" });
    profileSeed = await seedTerminalProfiles([PROMPT_PROFILE, BARE_PROFILE]);
  });

  test.afterEach(async () => {
    await profileSeed.restore();
    await workspace?.cleanup();
  });

  test("a profile that takes a prompt launches with it as its trailing argument; a profile without the sentinel launches bare from Launch", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await test.step("pick a profile that takes a prompt, type one, and submit", async () => {
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, PROMPT_PROFILE.id);
      await expectTerminalLaunchSelected(page, PROMPT_PROFILE.name);

      await fillTerminalPrompt(page, "fix the flaky test");
      await submitTerminalLaunch(page);
    });

    await test.step("the workspace opens with a terminal tab, and the profile received the prompt", async () => {
      await expectWorkspaceOpensWithTerminalTab(page);
      await expectTerminalOutputContains(page, "captured: fix the flaky test");
    });

    await test.step("a profile without the sentinel is read-only and shows the resolved command", async () => {
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, BARE_PROFILE.id);
      await expect(terminalPromptInput(page)).toHaveCount(0);
      // Derived from the profile rather than hardcoded: the preview shows the
      // resolved command, so a literal here would drift whenever the profile's
      // binary changes (the Node switch for Windows, issue 078).
      await expectTerminalPreviewCommand(
        page,
        [BARE_PROFILE.command, ...(BARE_PROFILE.args ?? [])].join(" "),
      );
      await expect(terminalLaunchSubmit(page)).toHaveText("Launch");
    });

    await test.step("Launch starts the profile bare, with no prompt to send", async () => {
      await submitTerminalLaunch(page);
      await expectWorkspaceOpensWithTerminalTab(page);
      await expectTerminalOutputContains(page, "bare-launch-static-line");
    });
  });
});
