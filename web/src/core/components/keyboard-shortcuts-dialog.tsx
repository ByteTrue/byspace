// Port of archive/expo-app:packages/app/src/components/keyboard-shortcuts-dialog.tsx: every shortcut with its effective keys, searchable; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/keyboard-shortcuts-dialog.py; edit it directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Shortcut } from "~/components/shortcut";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
} from "@/keyboard/keyboard-shortcuts";
import { filterShortcutHelpSections } from "@/keyboard/shortcut-help-search";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";

export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((s) => s.shortcutsDialogOpen);
  const setOpen = useKeyboardShortcutsStore((s) => s.setShortcutsDialogOpen);
  const [query, setQuery] = useState("");

  const shortcutOs = getShortcutOs();
  const isMac = shortcutOs === "mac";
  const { overrides } = useKeyboardShortcutOverrides();
  // Effective bindings, so a shortcut the user unassigned lists no keys here
  // instead of advertising a default that no longer fires.
  const bindings = useMemo(() => buildEffectiveBindings(overrides), [overrides]);
  const sections = useMemo(
    () => buildKeyboardShortcutHelpSections({ isMac }, bindings),
    [bindings, isMac],
  );
  const visibleSections = useMemo(
    () => filterShortcutHelpSections({ sections, query, translate: t, shortcutOs }),
    [query, sections, shortcutOs, t],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.shortcuts.dialogTitle"),
      search: {
        onChange: setQuery,
        resetKey: Number(open),
        placeholder: t("settings.shortcuts.searchPlaceholder"),
        autoFocus: true,
      },
    }),
    [open, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={open}
      onClose={handleClose}
      testID="keyboard-shortcuts-dialog"
    >
      <div data-testid="keyboard-shortcuts-dialog-content" className="flex flex-col gap-4">
        {visibleSections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t(section.titleKey)}</span>
            <ItemGroup>
              {section.rows.map((row) => (
                <Item key={row.id} variant="outline" data-testid={`shortcut-help-row-${row.id}`}>
                  <ItemContent>
                    <ItemTitle>{t(row.labelKey)}</ItemTitle>
                    {row.note ? (
                      <ItemDescription>{row.noteKey ? t(row.noteKey) : row.note}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    {row.chord === null ? (
                      <span className="text-sm text-muted-foreground">
                        {t("settings.shortcuts.unassigned")}
                      </span>
                    ) : (
                      <Shortcut chord={row.chord} />
                    )}
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </div>
        ))}
        {visibleSections.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("common.empty.noResults")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </AdaptiveModalSheet>
  );
}
