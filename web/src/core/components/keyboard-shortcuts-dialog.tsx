// Port of archive/expo-app:packages/app/src/components/keyboard-shortcuts-dialog.tsx: every shortcut with its effective keys, searchable; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/keyboard-shortcuts-dialog.py; edit it directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
} from "@/keyboard/keyboard-shortcuts";
import { filterShortcutHelpSections } from "@/keyboard/shortcut-help-search";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";

const SNAP_POINTS: string[] = ["70%", "92%"];

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
      snapPoints={SNAP_POINTS}
    >
      <div data-testid="keyboard-shortcuts-dialog-content" className="flex flex-col gap-4">
        {visibleSections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <span className="text-xs leading-[normal] font-medium text-muted-foreground">
              {t(section.titleKey)}
            </span>
            <div className="flex flex-col overflow-hidden rounded-[10px] border border-muted">
              {section.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-row items-center justify-between gap-3 border-b border-muted px-4 py-3"
                  data-testid={`shortcut-help-row-${row.id}`}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm leading-[normal] text-foreground">
                      {t(row.labelKey)}
                    </span>
                    {row.note ? (
                      <span className="mt-0.5 text-xs leading-[normal] text-muted-foreground">
                        {row.noteKey ? t(row.noteKey) : row.note}
                      </span>
                    ) : null}
                  </div>
                  {row.chord === null ? (
                    <span className="self-start text-sm leading-[normal] text-muted-foreground">
                      {t("settings.shortcuts.unassigned")}
                    </span>
                  ) : (
                    <span className="flex self-start">
                      <Shortcut chord={row.chord} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {visibleSections.length === 0 ? (
          <span className="block py-6 text-center text-sm leading-[normal] text-muted-foreground">
            {t("common.empty.noResults")}
          </span>
        ) : null}
      </div>
    </AdaptiveModalSheet>
  );
}
