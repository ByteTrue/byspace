export interface ForgeFeatureFlags {
  forgeProviders?: boolean;
  forgeSearch?: boolean;
  forgeCheckDetails?: boolean;
  checkoutForgeSetAutoMerge?: boolean;
  githubCheckDetails?: boolean;
  checkoutGithubSetAutoMerge?: boolean;
}

export type ForgeOperationRoute = "forge" | "legacy-github" | "unavailable";

export interface ForgeCapabilities {
  canPresent: boolean;
  search: ForgeOperationRoute;
  attachments: ForgeOperationRoute;
  checkDetails: ForgeOperationRoute;
  autoMerge: ForgeOperationRoute;
}

function resolveOperationRoute(input: {
  supportsForge: boolean;
  supportsLegacyGitHub: boolean;
  isGitHub: boolean;
}): ForgeOperationRoute {
  if (input.supportsForge) return "forge";
  if (input.isGitHub && input.supportsLegacyGitHub) return "legacy-github";
  return "unavailable";
}

export function resolveForgeCapabilities(input: {
  forge?: string | null;
  features?: ForgeFeatureFlags | null;
}): ForgeCapabilities {
  const forge = input.forge || "github";
  const isGitHub = forge === "github";
  const features = input.features;
  const search = resolveOperationRoute({
    supportsForge: features?.forgeSearch === true,
    supportsLegacyGitHub: true,
    isGitHub,
  });
  const checkDetails = resolveOperationRoute({
    supportsForge: features?.forgeCheckDetails === true,
    supportsLegacyGitHub: features?.githubCheckDetails === true,
    isGitHub,
  });
  const autoMerge = resolveOperationRoute({
    supportsForge: features?.checkoutForgeSetAutoMerge === true,
    supportsLegacyGitHub: features?.checkoutGithubSetAutoMerge === true,
    isGitHub,
  });

  return {
    canPresent: isGitHub || features?.forgeProviders === true,
    search,
    attachments: search,
    checkDetails,
    autoMerge,
  };
}
