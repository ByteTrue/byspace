import { Bot, PackagePlus } from "lucide-react";
import { createElement, type ComponentType } from "react";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";
import { ACP_PROVIDER_ICON_ALIASES, resolveProviderIconName } from "@/data/provider-icon-name";
import { SvgXml } from "@/platform/svg-xml";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

const BUILTIN_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  kiro: PackagePlus,
  minimax: MiniMaxIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
};

const CATALOG_ICON_SVGS = new Map(Object.entries(ACP_PROVIDER_ICON_SVGS));
for (const [provider, icon] of Object.entries(ACP_PROVIDER_ICON_ALIASES)) {
  const svg = ACP_PROVIDER_ICON_SVGS[icon as keyof typeof ACP_PROVIDER_ICON_SVGS];
  if (svg) CATALOG_ICON_SVGS.set(provider, svg);
}

const catalogIconComponents = new Map<string, ProviderIconComponent>();
const snapshotIconComponents = new Map<string, { svg: string; component: ProviderIconComponent }>();

function createSvgIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const SvgProviderIcon: ProviderIconComponent = ({ size, color }) =>
    createElement(SvgXml, {
      xml: iconSvg,
      width: size,
      height: size,
      color,
    });
  SvgProviderIcon.displayName = `SvgProviderIcon(${provider})`;
  return SvgProviderIcon;
}

function getCatalogProviderIcon(provider: string): ProviderIconComponent {
  const cached = catalogIconComponents.get(provider);
  if (cached) {
    return cached;
  }
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) {
    return Bot;
  }
  const icon = createSvgIcon(provider, iconSvg);
  catalogIconComponents.set(provider, icon);
  return icon;
}

function getSnapshotProviderIcon(provider: string, svg: string): ProviderIconComponent {
  const cached = snapshotIconComponents.get(provider);
  if (cached?.svg === svg) return cached.component;
  const component = createSvgIcon(provider, svg);
  snapshotIconComponents.set(provider, { svg, component });
  return component;
}

export function getProviderIcon(provider: string, serverId?: string | null): ProviderIconComponent {
  const name = resolveProviderIconName(provider, serverId);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id);
  }
  if (name.kind === "svg") {
    return getSnapshotProviderIcon(`${serverId}:${provider}`, name.svg);
  }
  return Bot;
}
