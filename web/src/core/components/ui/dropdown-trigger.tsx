// Port of archive/expo-app:packages/app/src/components/ui/dropdown-trigger.tsx: a dropdown trigger with its
// label and a trailing chevron (pass `chevron={null}` to drop it).
import type { ReactElement, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ICON_SIZE } from "@/styles/theme";
import { DropdownMenuTrigger, type DropdownMenuTriggerProps } from "@/components/ui/dropdown-menu";

interface DropdownTriggerProps extends Omit<DropdownMenuTriggerProps, "children"> {
  children?: ReactNode;
  chevron?: ReactNode | null;
}

export function DropdownTrigger({
  children,
  chevron,
  ...props
}: DropdownTriggerProps): ReactElement {
  return (
    <DropdownMenuTrigger {...props}>
      <span className="flex items-center gap-1">
        {children}
        {chevron !== null &&
          (chevron ?? (
            <span className="flex translate-y-px">
              <ChevronDown size={ICON_SIZE.sm} className="text-muted-foreground" />
            </span>
          ))}
      </span>
    </DropdownMenuTrigger>
  );
}
