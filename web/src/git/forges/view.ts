// Port of archive/expo-app:packages/app/src/git/forges/view.ts: the same registry, imported through `@/` so the
// web overrides of the individual forge views apply (overrides only replace `@/` imports).
import type { ClientForgeViewModule } from "@/git/client-forge-module";
import { codebergForgeView } from "@/git/forges/codeberg.view";
import { forgejoForgeView } from "@/git/forges/forgejo.view";
import { giteaForgeView } from "@/git/forges/gitea.view";
import { githubForgeView } from "@/git/forges/github.view";
import { gitlabForgeView } from "@/git/forges/gitlab.view";

/**
 * View registry: brand marks, brand colors, and PR-pane render contributions.
 * Import this only from rendering code (icon lookup, the PR pane); it pulls the
 * client rendering stack, so logic paths must use the logic registry instead.
 */
export const CLIENT_FORGE_VIEW_MODULES: readonly ClientForgeViewModule[] = [
  githubForgeView,
  gitlabForgeView,
  giteaForgeView,
  forgejoForgeView,
  codebergForgeView,
];

export function getClientForgeViewModule(id: string): ClientForgeViewModule | null {
  return CLIENT_FORGE_VIEW_MODULES.find((module) => module.id === id) ?? null;
}
