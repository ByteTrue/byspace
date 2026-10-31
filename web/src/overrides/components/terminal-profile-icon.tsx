// Override of packages/app/src/components/terminal-profile-icon.tsx: the profile's provider icon,
// or a terminal glyph, in the muted colour.
import type { ReactElement } from "react";
import { SquareTerminal } from "lucide-react";
import { getProviderIcon } from "@/components/provider-icons";

export function TerminalProfileIcon({
  iconKey,
  size = 14,
}: {
  iconKey: string | undefined;
  size?: number;
}): ReactElement {
  if (!iconKey) return <SquareTerminal size={size} className="shrink-0 text-muted-foreground" />;
  const Icon = getProviderIcon(iconKey);
  return (
    <span className="inline-flex shrink-0 text-muted-foreground">
      <Icon size={size} color="currentColor" />
    </span>
  );
}
