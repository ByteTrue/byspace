// Override of packages/app/src/agent-profiles/internal/agent-profile-glyph.tsx: a profile's icon in
// its identity colour (muted when it has none), the same everywhere a profile is drawn.
import {
  BookOpen,
  Boxes,
  Brain,
  Bug,
  Cloud,
  Code,
  Compass,
  Cpu,
  Database,
  Eye,
  Feather,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  Hammer,
  Layers,
  Microscope,
  Package,
  Palette,
  Pencil,
  Rocket,
  Search,
  Server,
  Shield,
  Sparkles,
  Star,
  Terminal,
  TestTube,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  resolveAgentProfileColor,
  resolveAgentProfileIconKey,
  type AgentProfileColor,
  type AgentProfileIconKey,
} from "@/agent-profiles/internal/profile-appearance";
import { identityForeground } from "@/styles/identity-colors";
import { ICON_SIZE } from "@/styles/theme";
import { useThemeObject } from "~/app/theme-object";

const ICONS: Record<AgentProfileIconKey, LucideIcon> = {
  code: Code,
  terminal: Terminal,
  bug: Bug,
  wrench: Wrench,
  hammer: Hammer,
  flask: FlaskConical,
  testTube: TestTube,
  microscope: Microscope,
  search: Search,
  eye: Eye,
  palette: Palette,
  feather: Feather,
  pencil: Pencil,
  fileText: FileText,
  book: BookOpen,
  rocket: Rocket,
  package: Package,
  boxes: Boxes,
  server: Server,
  database: Database,
  cpu: Cpu,
  cloud: Cloud,
  globe: Globe,
  gitBranch: GitBranch,
  layers: Layers,
  compass: Compass,
  brain: Brain,
  sparkles: Sparkles,
  shield: Shield,
};

/** The colour a profile colour draws in for the current scheme; `none` is muted. */
export function useAgentProfileColorValue(color: AgentProfileColor): string {
  const { colorScheme } = useThemeObject();
  return color === "none" ? "var(--muted-foreground)" : identityForeground(color, colorScheme);
}

/**
 * How a profile is drawn everywhere it appears — settings list, model picker,
 * and the picker grid's own cells. One component so the three can't drift.
 */
export function AgentProfileGlyph({
  icon,
  color,
  size = ICON_SIZE.md,
}: {
  icon?: string | undefined;
  color?: string | undefined;
  size?: number;
}) {
  const iconKey = resolveAgentProfileIconKey(icon);
  const colorValue = useAgentProfileColorValue(resolveAgentProfileColor(color));
  const Icon = iconKey ? ICONS[iconKey] : Star;
  return <Icon size={size} color={colorValue} />;
}
