// Override of packages/app/src/components/ui/autocomplete-popover.tsx: the autocomplete list
// floating above the composer input, as wide as it, never taller than the space above it. Focus
// stays in the composer, which owns visibility and the keyboard.
import type { ReactElement, RefObject } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { SPACING } from "@/styles/theme";

const OFFSET_FROM_ANCHOR = SPACING[3];
// As wide as the input, never taller than the space above it.
const CONTENT_STYLE = {
  width: "var(--radix-popper-anchor-width)",
  maxHeight: `calc(var(--radix-popper-available-height) - ${OFFSET_FROM_ANCHOR}px)`,
};

function preventDefault(event: Event) {
  event.preventDefault();
}

export function AutocompletePopover({
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
}: {
  visible: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
}): ReactElement | null {
  if (!visible || (options.length > 0 && selectedIndex < 0)) return null;
  return (
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Anchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="start"
          sideOffset={OFFSET_FROM_ANCHOR}
          avoidCollisions={false}
          onOpenAutoFocus={preventDefault}
          onCloseAutoFocus={preventDefault}
          data-testid="composer-autocomplete-popover"
          className="z-50 flex flex-col outline-none"
          style={CONTENT_STYLE}
        >
          <Autocomplete
            options={options}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
