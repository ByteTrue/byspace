import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import {
  buildEffectiveBindings,
  buildKeyboardShortcutHelpSections,
} from "@/keyboard/keyboard-shortcuts";
import { filterShortcutHelpSections } from "@/keyboard/shortcut-help-search";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { Shortcut } from "~/components/shortcut";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";

type ShortcutHelpSection = ReturnType<typeof buildKeyboardShortcutHelpSections>[number];

function ShortcutSection({ section }: { section: ShortcutHelpSection }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{t(section.titleKey)}</h3>
      <div className="flex flex-col divide-y rounded-lg border">
        {section.rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 px-3 py-2"
            data-testid={`shortcut-help-row-${row.id}`}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{t(row.labelKey)}</span>
              {row.note ? (
                <span className="text-xs text-muted-foreground">
                  {row.noteKey ? t(row.noteKey) : row.note}
                </span>
              ) : null}
            </div>
            {row.chord === null ? (
              <span className="text-xs text-muted-foreground">
                {t("settings.shortcuts.unassigned")}
              </span>
            ) : (
              <Shortcut chord={row.chord} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** packages/app's KeyboardShortcutsDialog: every shortcut with its effective keys, searchable. */
export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useKeyboardShortcutsStore((state) => state.shortcutsDialogOpen);
  const setOpen = useKeyboardShortcutsStore((state) => state.setShortcutsDialogOpen);
  const [query, setQuery] = useState("");
  const shortcutOs = getShortcutOs();
  const { overrides } = useKeyboardShortcutOverrides();
  // Effective bindings, so a shortcut the user unassigned lists no keys instead of a dead default.
  const bindings = useMemo(() => buildEffectiveBindings(overrides), [overrides]);
  const sections = useMemo(
    () => buildKeyboardShortcutHelpSections({ isMac: shortcutOs === "mac" }, bindings),
    [bindings, shortcutOs],
  );
  const visibleSections = useMemo(
    () => filterShortcutHelpSections({ sections, query, translate: t, shortcutOs }),
    [query, sections, shortcutOs, t],
  );
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-4 sm:max-w-lg"
        data-testid="keyboard-shortcuts-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("settings.shortcuts.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            value={query}
            onChange={handleQueryChange}
            placeholder={t("settings.shortcuts.searchPlaceholder")}
          />
        </InputGroup>
        <div
          className="-mx-6 flex min-h-0 flex-col gap-4 overflow-y-auto px-6"
          data-testid="keyboard-shortcuts-dialog-content"
        >
          {visibleSections.map((section) => (
            <ShortcutSection key={section.title} section={section} />
          ))}
          {visibleSections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.empty.noResults")}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
