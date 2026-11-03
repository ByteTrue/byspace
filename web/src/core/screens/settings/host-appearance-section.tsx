// Port of archive/expo-app:packages/app/src/screens/settings/host-appearance-section.tsx: host name, colour and badge, with a preview row; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/host-appearance-section.py; edit it directly.
import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ChevronDown, Pencil } from "lucide-react";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { WorkspaceMetaRow } from "~/sidebar/meta-row";
import { useToast } from "@/contexts/toast-context";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  HOST_BADGE_DISPLAYS,
  HOST_COLORS,
  resolveHostBadgeDisplay,
  type HostBadgeDisplay,
  type HostColor,
} from "@/hosts/appearance";
import { useHostMutations } from "@/runtime/host-runtime";
import { identityColor } from "@/styles/identity-colors";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { withTheme } from "~/app/theme-object";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";
import { Item, ItemContent, ItemGroup, ItemTitle } from "~/components/ui/item";

const ThemedChevronDown = withTheme(ChevronDown);
const ThemedPencil = withTheme(Pencil);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const TRIGGER = "flex flex-row items-center gap-1 rounded-md border px-2 py-1 active:opacity-85";

function HostRenameButton({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { renameHost } = useHostMutations();
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = useCallback(
    async (value: string) => {
      const nextLabel = value.trim();
      if (nextLabel === host.label.trim()) return;
      await renameHost(host.serverId, nextLabel);
    },
    [host.label, host.serverId, renameHost],
  );

  const openEditor = useCallback(() => setIsEditing(true), []);
  const closeEditor = useCallback(() => setIsEditing(false), []);

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className="rounded-md p-1"
        aria-label={t("settings.host.daemon.rename.editLabel")}
        data-testid="host-page-label-edit-button"
      >
        <ThemedPencil size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
      </button>

      <AdaptiveRenameModal
        visible={isEditing}
        title={t("settings.host.daemon.rename.title")}
        initialValue={host.label}
        placeholder={t("settings.host.daemon.rename.placeholder")}
        submitLabel={t("settings.host.daemon.rename.submit")}
        onClose={closeEditor}
        onSubmit={handleSubmit}
        testID="host-page-rename-modal"
      />
    </>
  );
}

function colorLabel(t: TFunction, color: HostColor): string {
  return t(`settings.host.appearance.color.options.${color}`);
}

function badgeDisplayLabel(t: TFunction, display: HostBadgeDisplay): string {
  return t(`settings.host.appearance.badge.options.${display}`);
}

function ColorSwatch({ color }: { color: HostColor }) {
  const swatchStyle = useMemo(
    () => (color === "none" ? undefined : { backgroundColor: identityColor(color) }),
    [color],
  );
  return <span className="size-4 shrink-0 rounded-full border" style={swatchStyle} />;
}

function ColorMenuItem({
  color,
  selected,
  onChange,
}: {
  color: HostColor;
  selected: boolean;
  onChange: (color: HostColor) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(color), [color, onChange]);
  const leading = useMemo(() => <ColorSwatch color={color} />, [color]);
  return (
    <DropdownMenuCheckboxItem checked={selected} onSelect={handleSelect}>
      {leading}
      {colorLabel(t, color)}
    </DropdownMenuCheckboxItem>
  );
}

function ColorRow({ color, onChange }: { color: HostColor; onChange: (color: HostColor) => void }) {
  const { t } = useTranslation();
  const selectedLabel = colorLabel(t, color);
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t("settings.host.appearance.color.label")}</ItemTitle>
      </ItemContent>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={TRIGGER}
          aria-label={t("settings.host.appearance.color.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <ColorSwatch color={color} />
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="w-[200px]"
          onCloseAutoFocus={keepFocusElsewhere}
        >
          {HOST_COLORS.map((option) => (
            <ColorMenuItem
              key={option}
              color={option}
              selected={option === color}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Item>
  );
}

function BadgeDisplayRow({
  badgeDisplay,
  onChange,
}: {
  badgeDisplay: HostBadgeDisplay;
  onChange: (badgeDisplay: HostBadgeDisplay) => void;
}) {
  const { t } = useTranslation();
  const selectedLabel = badgeDisplayLabel(t, badgeDisplay);
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t("settings.host.appearance.badge.label")}</ItemTitle>
      </ItemContent>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="host-appearance-badge-display"
          className={TRIGGER}
          aria-label={t("settings.host.appearance.badge.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>
          <ThemedChevronDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="w-[200px]"
          onCloseAutoFocus={keepFocusElsewhere}
        >
          {HOST_BADGE_DISPLAYS.map((option) => (
            <BadgeDisplayMenuItem
              key={option}
              display={option}
              selected={option === badgeDisplay}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Item>
  );
}

function BadgeDisplayMenuItem({
  display,
  selected,
  onChange,
}: {
  display: HostBadgeDisplay;
  selected: boolean;
  onChange: (display: HostBadgeDisplay) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(display), [display, onChange]);
  return (
    <DropdownMenuCheckboxItem checked={selected} onSelect={handleSelect}>
      {badgeDisplayLabel(t, display)}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * Shows explicit badge choices as the sidebar draws them. Automatic uses its visible, named form;
 * project cardinality still decides whether a real sidebar row shows it. The preview uses the real
 * component rather than a restyled copy.
 */
function BadgePreview({
  host,
  badgeDisplay,
}: {
  host: HostProfile;
  badgeDisplay: HostBadgeDisplay;
}) {
  const { t } = useTranslation();
  const hostBadge = useMemo(
    () =>
      badgeDisplay === "hidden"
        ? null
        : {
            serverId: host.serverId,
            label: host.label,
            color: host.appearance.color,
            showLabel: badgeDisplay === "auto" || badgeDisplay === "name",
            display: badgeDisplay,
          },
    [badgeDisplay, host.serverId, host.label, host.appearance.color],
  );
  // Use the real sidebar row so badge styling stays aligned with the setting's visible form.
  return (
    <div
      className="flex flex-col items-start gap-1 border-t bg-sidebar px-4 py-3"
      data-testid="host-appearance-preview"
    >
      <span className="mb-0.5 text-xs leading-[normal] font-medium tracking-[0.5px] text-muted-foreground uppercase">
        PREVIEW
      </span>
      <span className="max-w-full shrink truncate text-sm leading-[normal] text-muted-foreground">
        {t("settings.host.appearance.preview.workspaceName")}
      </span>
      <WorkspaceMetaRow
        currentBranch={null}
        projectName={null}
        hostBadge={hostBadge}
        prHint={null}
        serviceSummary={null}
      />
    </div>
  );
}

export function HostAppearanceSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { setHostColor, setHostBadgeDisplay } = useHostMutations();
  const badgeDisplay = resolveHostBadgeDisplay({ appearance: host.appearance });

  const handleColorChange = useCallback(
    async (color: HostColor) => {
      try {
        await setHostColor(host.serverId, color);
      } catch {
        toast.error(t("common.errors.unableToSave"));
      }
    },
    [host.serverId, setHostColor, t, toast],
  );
  const handleBadgeDisplayChange = useCallback(
    async (next: HostBadgeDisplay) => {
      try {
        await setHostBadgeDisplay(host.serverId, next);
      } catch {
        toast.error(t("common.errors.unableToSave"));
      }
    },
    [host.serverId, setHostBadgeDisplay, t, toast],
  );

  return (
    <SettingsSection title={t("settings.host.appearance.title")}>
      <ItemGroup>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.appearance.name.label")}</ItemTitle>
          </ItemContent>
          <div className="flex shrink flex-row items-center gap-2">
            <span className="shrink truncate text-sm leading-[normal] text-muted-foreground">
              {host.label}
            </span>
            <HostRenameButton host={host} />
          </div>
        </Item>
        <ColorRow color={host.appearance.color} onChange={handleColorChange} />
        <BadgeDisplayRow badgeDisplay={badgeDisplay} onChange={handleBadgeDisplayChange} />
        <BadgePreview host={host} badgeDisplay={badgeDisplay} />
      </ItemGroup>
    </SettingsSection>
  );
}
