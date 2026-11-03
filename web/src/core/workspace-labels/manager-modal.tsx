// Port of archive/expo-app:packages/app/src/workspace-labels/manager-modal.tsx: one host's label catalog and the label edit view, on AdaptiveModalSheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/workspace-label-manager.py; edit it directly.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Pencil } from "lucide-react";
import {
  workspaceLabelKey,
  type WorkspaceLabelColor,
  type WorkspaceLabelDefinition,
} from "@bytetrue/protocol/workspace-labels";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHosts } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  createWorkspaceLabelManagerModel,
  useWorkspaceLabelProjection,
  workspaceLabels,
  type WorkspaceLabelManagerDraft,
} from "@/workspace-labels";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "./swatch";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Input } from "~/components/ui/input";
import { Field, FieldLabel } from "~/components/ui/field";

/** The size the host pill's own glyphs use, so the row's trailing mark matches the controls above it. */
const EDIT_ICON_SIZE = 14;

/**
 * The whole label catalog of one host, and editing any one of them.
 *
 * Two views, one sheet: the list, and the edit view the pencil opens. The edit view is reached
 * the way every other sheet reaches a second page — the header's back arrow returns from it —
 * because a label row is a label, not a button that swaps the surface under you.
 */
export function WorkspaceLabelManagerModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const snapshots = useMemo(
    () => Object.fromEntries(labelHosts.map((host) => [host.serverId, host])),
    [labelHosts],
  );
  const [model] = useState(() =>
    createWorkspaceLabelManagerModel({
      update: (input) => workspaceLabels.update(input),
      inspectDelete: (input) => workspaceLabels.inspectDelete(input),
      delete: (input) => workspaceLabels.delete(input),
    }),
  );

  useEffect(() => {
    // Closing ends the edit, so reopening lands on the list rather than on whatever was half
    // typed a session ago.
    if (!visible) {
      model.reset();
      return;
    }
    model.syncHosts(
      hosts.map((host) => ({
        serverId: host.serverId,
        label: host.label || host.serverId,
        status: snapshots[host.serverId]?.status ?? "offline",
        labels: snapshots[host.serverId]?.labels ?? [],
        error: snapshots[host.serverId]?.error,
      })),
    );
  }, [hosts, model, snapshots, visible]);
  const state = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const draft = state.draft;
  const editing = state.editing;
  const disabled = state.host?.status !== "online" || state.pending;

  const selectHost = useCallback((serverId: string) => model.selectHost(serverId), [model]);
  const setQuery = useCallback((value: string) => model.setQuery(value), [model]);
  const edit = useCallback((label: WorkspaceLabelDefinition) => model.edit(label), [model]);
  const cancelEdit = useCallback(() => model.cancelEdit(), [model]);
  const setDraftName = useCallback((value: string) => model.setDraftName(value), [model]);
  const setDraftColor = useCallback(
    (color: WorkspaceLabelColor) => model.setDraftColor(color),
    [model],
  );
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const remove = useCallback((): void => {
    if (!editing) return;
    void model.delete((affected) =>
      confirmDialog({
        title: t("workspaceLabels.manage.deleteTitle", { name: editing.name }),
        message: t("workspaceLabels.manage.deleteMessage", { count: affected }),
        confirmLabel: t("workspaceLabels.manage.delete"),
        destructive: true,
      }),
    );
  }, [editing, model, t]);

  const isEditing = draft !== null;
  // Search belongs to the sheet's header, where it spans the header's own rails and needs no
  // layout from this caller. `resetKey` empties the uncontrolled field on the same event that
  // clears the model's query, so the box and the list never disagree about what is filtered.
  const header = useMemo<SheetHeader>(
    () =>
      isEditing
        ? {
            title: t("workspaceLabels.manage.edit"),
            back: { onPress: cancelEdit },
          }
        : {
            title: t("workspaceLabels.manage.title"),
            search: {
              onChange: setQuery,
              resetKey: Number(visible),
              placeholder: t("workspaceLabels.manage.search"),
              testID: "workspace-label-manager-search",
            },
          },
    [cancelEdit, isEditing, setQuery, t, visible],
  );
  const footer = useMemo(
    () =>
      isEditing ? (
        <div className="flex flex-1 flex-row items-center justify-between gap-2">
          <Button
            // Red belongs to the confirm dialog, not to the surface that opens it — docs/design.md.
            variant="outline"
            size="md"
            disabled={disabled}
            onPress={remove}
            testID="workspace-label-manager-delete"
          >
            {t("workspaceLabels.manage.delete")}
          </Button>
          <Button
            size="md"
            className="min-w-28"
            disabled={disabled || !state.dirty}
            loading={state.pending}
            onPress={save}
            testID="workspace-label-manager-save"
          >
            {t("workspaceLabels.manage.save")}
          </Button>
        </div>
      ) : undefined,
    [disabled, isEditing, remove, save, state.dirty, state.pending, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      // Bound the compact scroller to the live snap height, so the edit view's footer stays on
      // screen instead of being pushed past the bottom of the sheet.
      sizeContentToCurrentSnapPoint
      testID="workspace-label-manager"
    >
      {draft && editing ? (
        <WorkspaceLabelEditView
          draft={draft}
          disabled={disabled}
          error={state.error}
          onChangeName={setDraftName}
          onChangeColor={setDraftColor}
          onSubmit={save}
        />
      ) : (
        <>
          {hosts.length > 1 ? (
            <HostFilter
              hosts={hosts}
              selectedHost={state.serverId}
              onSelectHost={selectHost}
              includeAllHost={false}
              triggerTestID="workspace-label-manager-host"
              hostOptionTestID={managerHostOptionTestID}
            />
          ) : null}
          <div className="flex flex-col gap-1">
            {state.labels.map((label) => (
              <WorkspaceLabelManagerRow
                key={workspaceLabelKey(label.name)}
                label={label}
                disabled={disabled}
                onEdit={edit}
              />
            ))}
            {state.labels.length === 0 ? (
              <span className="text-xs leading-[normal] text-muted-foreground">
                {t("workspaceLabels.manage.empty")}
              </span>
            ) : null}
          </div>
          {state.host?.status === "offline" ? (
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("workspaceLabels.manage.offline")}
            </span>
          ) : null}
          {state.host?.status === "unsupported" ? (
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("workspaceLabels.manage.updateHost")}
            </span>
          ) : null}
          {(state.error ?? state.host?.error) ? (
            <span
              className="text-xs leading-[normal] text-destructive"
              data-testid="workspace-label-manager-error"
            >
              {state.error ?? state.host?.error}
            </span>
          ) : null}
        </>
      )}
    </AdaptiveModalSheet>
  );
}

const managerHostOptionTestID = (serverId: string) => `workspace-label-manager-host-${serverId}`;

/**
 * One label: its colour, its name, and the pencil that opens it.
 *
 * Hover lives on the plain outer `View` and press on the inner `Pressable`, which is the one
 * shape that survives a pressable inside a hover target (docs/hover.md). The pencil fades rather
 * than mounts, so revealing it cannot move the row out from under the pointer.
 */
function WorkspaceLabelManagerRow({
  label,
  disabled,
  onEdit,
}: {
  label: WorkspaceLabelDefinition;
  disabled: boolean;
  onEdit: (label: WorkspaceLabelDefinition) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const edit = useCallback(() => onEdit(label), [label, onEdit]);
  const revealed = isHovered || isCompact;
  // A fixed 32px row, so the pencil appearing cannot resize it under the pointer.
  return (
    <div
      className="flex min-h-8 flex-row items-center gap-2"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid={`workspace-label-manager-label-${label.name}`}
    >
      <WorkspaceLabelDot color={label.color} />
      <span className="min-w-0 flex-1 truncate text-xs leading-[normal] text-foreground">
        {label.name}
      </span>
      <button
        type="button"
        aria-label={t("workspaceLabels.manage.editLabel", { name: label.name })}
        disabled={disabled}
        onClick={edit}
        className={cn(
          "flex items-center justify-center text-muted-foreground outline-none active:opacity-60",
          !revealed && "pointer-events-none opacity-0",
        )}
        data-testid={`workspace-label-manager-edit-${label.name}`}
      >
        <Pencil size={EDIT_ICON_SIZE} />
      </button>
    </div>
  );
}

/**
 * A label's name and colour, changed together and committed once by the footer's Save.
 *
 * Picking a colour picks a colour — nothing leaves for the host until Save, so a failure has one
 * thing to report and the draft is still exactly what was typed.
 */
function WorkspaceLabelEditView({
  draft,
  disabled,
  error,
  onChangeName,
  onChangeColor,
  onSubmit,
}: {
  draft: WorkspaceLabelManagerDraft;
  disabled: boolean;
  error: string | null;
  onChangeName: (value: string) => void;
  onChangeColor: (color: WorkspaceLabelColor) => void;
  onSubmit: () => void;
}): ReactElement {
  const handleSubmitEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) onSubmit();
    },
    [onSubmit],
  );
  const handleChangeNameInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChangeName(event.target.value),
    [onChangeName],
  );
  const { t } = useTranslation();
  return (
    <>
      <Field>
        <FieldLabel>{t("workspaceLabels.manage.name")}</FieldLabel>
        <Input
          defaultValue={draft.name}
          key={draft.name}
          onChange={handleChangeNameInput}
          onKeyDown={handleSubmitEnter}
          readOnly={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label={t("workspaceLabels.manage.name")}
          data-testid="workspace-label-manager-name"
        />
      </Field>
      <Field>
        <FieldLabel>{t("workspaceLabels.manage.color")}</FieldLabel>
        <WorkspaceLabelSwatchRow
          value={draft.color}
          onChange={onChangeColor}
          disabled={disabled}
          testID="workspace-label-manager-colors"
        />
      </Field>
      {error ? (
        <span
          className="text-xs leading-[normal] text-destructive"
          data-testid="workspace-label-manager-error"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}
