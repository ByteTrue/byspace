/**
 * Brand marks are SVG React components, so they cannot travel over the wire as
 * a string. This file derives icon and brand-color lookup tables from
 * CLIENT_FORGE_VIEW_MODULES; a new forge ships an icon component in the client
 * bundle and references it from its view module. Unknown icon kinds fall back to
 * a generic pull-request glyph.
 */
import { GitPullRequest } from "lucide-react";
import { cn } from "cn";
import {
  type ForgeBrandColor,
  type ForgeIconColorMapping,
  type ForgeIconComponent,
} from "@/git/client-forge-module";
import { CLIENT_FORGE_VIEW_MODULES } from "@/git/forges/view";
import { withTheme } from "@/app/theme-object";

const FORGE_ICON_BY_KIND = new Map(
  CLIENT_FORGE_VIEW_MODULES.map((module) => [module.id, module.icon]),
);

/**
 * Raw brand icon component for an `iconKind`, for call sites that style with a
 * plain `color` prop. Falls back to a generic pull-request glyph.
 */
export function getForgeIconComponent(iconKind: string): ForgeIconComponent {
  return FORGE_ICON_BY_KIND.get(iconKind) ?? GitPullRequest;
}

const THEMED_ICON_BY_KIND = Object.fromEntries(
  CLIENT_FORGE_VIEW_MODULES.map((module) => [module.id, withTheme(module.icon)]),
);
const ThemedGitPullRequest = withTheme(GitPullRequest);

/** Theme-driven color mapping, e.g. `(theme) => ({ color: theme.colors.foregroundMuted })`. */
export type { ForgeIconColorMapping };

function brandColorMapping(colors: ForgeBrandColor): ForgeIconColorMapping {
  return (theme) => ({ color: theme.colorScheme === "light" ? colors.light : colors.dark });
}

const BRAND_COLOR_MAPPING_BY_KIND = new Map(
  CLIENT_FORGE_VIEW_MODULES.flatMap((module) =>
    module.brandColor ? [[module.id, brandColorMapping(module.brandColor)] as const] : [],
  ),
);

/**
 * The forge's brand color mapping, or null for forges with no dedicated brand
 * color (github renders in a neutral tone; an unknown forge has none). Call
 * sites pair this with {@link ForgeBrandIcon}: use it to tint the icon, or to
 * decide whether to show a brand badge at all.
 */
export function getForgeBrandColorMapping(iconKind: string): ForgeIconColorMapping | null {
  return BRAND_COLOR_MAPPING_BY_KIND.get(iconKind) ?? null;
}

/**
 * The forge's icon sized and colored by Tailwind classes, for menus and rows. Resolves the kind
 * through the same registry as {@link ForgeBrandIcon}, so a new forge needs no change here.
 */
export function ForgeIcon({ iconKind, className }: { iconKind: string; className?: string }) {
  const Icon = getForgeIconComponent(iconKind);
  return <Icon className={cn("size-3 shrink-0", className)} />;
}

/**
 * Themed brand icon for an `iconKind`, for call sites that color through a theme
 * mapping (`themeProps`). Falls back to a generic pull-request glyph for unknown forges.
 */
export function ForgeBrandIcon({
  iconKind,
  size,
  themeProps,
}: {
  iconKind: string;
  size: number;
  themeProps: ForgeIconColorMapping;
}) {
  const ThemedIcon = THEMED_ICON_BY_KIND[iconKind] ?? ThemedGitPullRequest;
  return <ThemedIcon size={size} themeProps={themeProps} />;
}
