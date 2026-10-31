// Override of packages/app/src/git/forges/gitlab.view.tsx: the GitLab brand mark and colour.
// shortcut: the GitLab merge-request contributions (approvals badge, pipeline section) render in
// the PR pane, which moves in batch 7 of step 3; they come back with it.
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

export const gitlabForgeView = {
  id: "gitlab",
  icon: GitLabIcon,
  brandColor: {
    light: "#FC6D26",
    dark: "#FC6D26",
  },
} satisfies ClientForgeViewModule;
