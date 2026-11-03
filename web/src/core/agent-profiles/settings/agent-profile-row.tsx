// Port of archive/expo-app:packages/app/src/agent-profiles/settings/agent-profile-row.tsx: one agent profile row; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agent-profiles-section.py; edit it directly.
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, FileText, Pencil, Trash2 } from "lucide-react";
import { cn } from "cn";
import type { ProviderSnapshotEntry } from "@bytetrue/protocol/agent-types";
import type { AgentProfile } from "@bytetrue/protocol/messages";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { AgentProfileGlyph } from "@/agent-profiles/internal/agent-profile-glyph";
import { buildAgentProfileTags } from "@/agent-profiles/internal/profile-summary";
import { withTheme } from "~/app/theme-object";

const ThemedArrowUp = withTheme(ArrowUp);
const ThemedArrowDown = withTheme(ArrowDown);
const ThemedPencil = withTheme(Pencil);
const ThemedTrash2 = withTheme(Trash2);
const ThemedFileText = withTheme(FileText);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} themeProps={mutedColorMapping} />;
const removeIcon = <ThemedTrash2 size={ICON_SIZE.sm} themeProps={destructiveColorMapping} />;

export interface AgentProfileRowProps {
  profile: AgentProfile;
  entries: readonly ProviderSnapshotEntry[] | undefined;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export function AgentProfileRow({
  profile,
  entries,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: AgentProfileRowProps): ReactElement {
  const { t } = useTranslation();

  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);

  const formatFeatureCount = useCallback(
    (count: number) =>
      count === 1
        ? t("settings.host.agentProfiles.featureCountOne", { count })
        : t("settings.host.agentProfiles.featureCount", { count }),
    [t],
  );
  const tags = useMemo(
    () => buildAgentProfileTags({ profile, entries, formatFeatureCount }),
    [entries, formatFeatureCount, profile],
  );
  const summary = useMemo(() => tags.map((tag) => tag.label).join(" · "), [tags]);

  return (
    <div
      className={cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "min-h-14 items-center gap-2 py-3",
      )}
      data-testid={`agent-profile-row-${profile.id}`}
    >
      <div className="flex flex-1 flex-row items-start gap-2">
        <div className="mt-px flex w-4 items-center justify-center">
          <AgentProfileGlyph icon={profile.icon} color={profile.color} size={ICON_SIZE.md} />
        </div>
        <div className={settingsStyles.rowContent}>
          <div className="flex min-w-0 flex-row items-baseline gap-2">
            <span className={cn(settingsStyles.rowTitle, "truncate")}>{profile.name}</span>
            <span className="shrink truncate text-xs leading-[normal] text-muted-foreground">
              {summary}
            </span>
          </div>
          {profile.notes ? (
            <div className="mt-1 flex flex-row items-start gap-1">
              <ThemedFileText size={ICON_SIZE.xs} themeProps={mutedColorMapping} />
              <span
                className="line-clamp-2 flex-1 text-xs leading-[normal] text-muted-foreground"
                data-testid={`agent-profile-notes-${profile.id}`}
              >
                {profile.notes}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-row items-center">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.host.agentProfiles.moveUp")}
          testID={`agent-profile-move-up-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.host.agentProfiles.moveDown")}
          testID={`agent-profile-move-down-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.host.agentProfiles.editProfile")}
          testID={`agent-profile-edit-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeIcon}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.agentProfiles.remove")}
          testID={`agent-profile-remove-${profile.id}`}
        />
      </div>
    </div>
  );
}
