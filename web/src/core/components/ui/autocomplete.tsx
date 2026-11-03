// Port of archive/expo-app:packages/app/src/components/ui/autocomplete.tsx: the slash-command and @-file list
// above the composer. The list starts scrolled to its end (the match nearest the input) and keeps
// the keyboard-selected row in view; a selected command's description sits in a card above.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { File, Folder } from "lucide-react";
import { cn } from "cn";
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

const PANEL = "overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md";

/** A press on a row keeps focus (and the caret) in the composer. */
function keepComposerFocus(event: MouseEvent) {
  event.preventDefault();
}

function AutocompleteRow({
  option,
  isSelected,
  onSelect,
}: {
  option: AutocompleteOption;
  isSelected: boolean;
  onSelect: (option: AutocompleteOption) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const optionLabel = removeBoltGlyphs(option.label) ?? option.label;
  const optionDescription = removeBoltGlyphs(option.description);
  const optionDetail = removeBoltGlyphs(option.detail);
  const isFileOrDir = option.kind === "directory" || option.kind === "file";
  const handleClick = useCallback(() => onSelect(option), [onSelect, option]);
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);
  return (
    <button
      ref={rowRef}
      type="button"
      tabIndex={-1}
      onMouseDown={keepComposerFocus}
      onClick={handleClick}
      className={cn(
        "flex min-h-9 w-full items-center px-3 py-2 text-left hover:bg-muted",
        isSelected && "bg-muted",
      )}
    >
      {isFileOrDir ? (
        <>
          <span className="mr-1 flex w-[18px] shrink-0 items-center justify-center text-muted-foreground">
            {option.kind === "directory" ? <Folder size={14} /> : <File size={14} />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <span className="text-sm text-foreground">{optionLabel}</span>
              {optionDetail ? (
                <span className="text-xs text-muted-foreground">{optionDetail}</span>
              ) : null}
            </span>
            {optionDescription ? (
              <span className="mt-0.5 truncate text-xs text-muted-foreground">
                {optionDescription}
              </span>
            ) : null}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm text-foreground">{optionLabel}</span>
          {optionDescription ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {optionDescription}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}

export function Autocomplete({
  options,
  selectedIndex,
  onSelect,
  isLoading = false,
  errorMessage,
  loadingText,
  emptyText,
  maxHeight = 220,
}: AutocompleteProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelStyle = useMemo(() => ({ maxHeight }), [maxHeight]);
  // New options start pinned to the end, nearest the input.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [options]);

  if (isLoading || errorMessage || options.length === 0) {
    let content = (
      <span className="text-sm text-muted-foreground">
        {emptyText ?? t("common.empty.noResults")}
      </span>
    );
    if (isLoading) {
      content = (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {loadingText ?? t("common.states.loading")}
        </span>
      );
    } else if (errorMessage) {
      content = <span className="text-sm text-muted-foreground">Error: {errorMessage}</span>;
    }
    return (
      <div className={cn(PANEL, "p-3")} style={panelStyle}>
        {content}
      </div>
    );
  }

  const selectedOption = options[selectedIndex];
  return (
    <div className="flex min-h-0 shrink flex-col gap-1">
      {selectedOption?.kind === "command" && selectedOption.description ? (
        <div className={cn(PANEL, "p-3")}>
          <div className="text-sm text-foreground">
            {removeBoltGlyphs(selectedOption.label) ?? selectedOption.label}
          </div>
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
      <div className={cn(PANEL, "flex min-h-0 shrink flex-col")} style={panelStyle}>
        <div ref={scrollRef} className="min-h-0 shrink overflow-y-auto py-1">
          {options.map((option, index) => (
            <AutocompleteRow
              key={option.id}
              option={option}
              isSelected={index === selectedIndex}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
