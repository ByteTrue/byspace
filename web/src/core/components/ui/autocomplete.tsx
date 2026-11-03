// The slash-command and @-file list above the composer: shadcn's Command, driven by the composer.
// Focus and the keyboard stay in the composer, which moves the selection (`selectedIndex`); the list
// starts scrolled to its end (the match nearest the input) and keeps the selected row in view. A
// selected command's description sits above the list.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { File, Folder } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Spinner } from "~/components/ui/spinner";

export interface AutocompleteOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  kind?: "command" | "file" | "directory";
}

interface AutocompleteProps {
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  /** The pointer moved onto a row: the composer makes it the selection. */
  onHighlight?: (index: number) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  maxHeight?: number;
}

const BOLT_GLYPH_PATTERN = /\u26A1|\uFE0F/gu;

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) return value;
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** A press on a row keeps focus (and the caret) in the composer. */
function keepComposerFocus(event: MouseEvent) {
  event.preventDefault();
}

function AutocompleteItem({
  option,
  onSelect,
}: {
  option: AutocompleteOption;
  onSelect: (option: AutocompleteOption) => void;
}) {
  const label = removeBoltGlyphs(option.label) ?? option.label;
  const description = removeBoltGlyphs(option.description);
  const detail = removeBoltGlyphs(option.detail);
  const handleSelect = useCallback(() => onSelect(option), [onSelect, option]);
  const isFileOrDir = option.kind === "directory" || option.kind === "file";
  return (
    <CommandItem value={option.id} onSelect={handleSelect} onMouseDown={keepComposerFocus}>
      {option.kind === "directory" ? <Folder /> : null}
      {option.kind === "file" ? <File /> : null}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span>{label}</span>
        {isFileOrDir && detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
        {description ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </CommandItem>
  );
}

export function Autocomplete({
  options,
  selectedIndex,
  onSelect,
  onHighlight,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  maxHeight = 220,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const listStyle = useMemo(() => ({ maxHeight }), [maxHeight]);
  const selectedOption = options[selectedIndex];

  // New options start pinned to the end, nearest the input.
  useLayoutEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [options]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-slot="command-item"][data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleValueChange = useCallback(
    (id: string) => {
      const index = options.findIndex((option) => option.id === id);
      if (index >= 0 && index !== selectedIndex) onHighlight?.(index);
    },
    [onHighlight, options, selectedIndex],
  );

  let status: ReactNode = null;
  if (isLoading) {
    status = (
      <span className="flex items-center justify-center gap-2 text-muted-foreground">
        <Spinner />
        {loadingText ?? t("common.states.loading")}
      </span>
    );
  } else if (errorMessage) {
    status = <span className="text-muted-foreground">Error: {errorMessage}</span>;
  } else if (options.length === 0) {
    status = (
      <span className="text-muted-foreground">{emptyText ?? t("common.empty.noResults")}</span>
    );
  }

  return (
    // Floats above the composer like a popover: the popover surface's shadow and ring.
    <Command
      shouldFilter={false}
      value={selectedOption?.id ?? ""}
      onValueChange={handleValueChange}
      className="min-h-0 shrink shadow-md ring-1 ring-foreground/10"
    >
      {!status && selectedOption?.kind === "command" && selectedOption.description ? (
        <div className="border-b px-2 pt-1.5 pb-2 text-sm">
          <div>{removeBoltGlyphs(selectedOption.label) ?? selectedOption.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {removeBoltGlyphs(selectedOption.description)}
          </div>
          {selectedOption.detail ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {removeBoltGlyphs(selectedOption.detail)}
            </div>
          ) : null}
        </div>
      ) : null}
      <CommandList ref={listRef} style={listStyle}>
        {status ? (
          <CommandEmpty>{status}</CommandEmpty>
        ) : (
          <CommandGroup>
            {options.map((option) => (
              <AutocompleteItem key={option.id} option={option} onSelect={onSelect} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
