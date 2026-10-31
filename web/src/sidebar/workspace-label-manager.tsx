import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { ChevronDown, ChevronLeft, Pencil, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  workspaceLabelKey,
  type WorkspaceLabelColor,
  type WorkspaceLabelDefinition,
} from "@bytetrue/protocol/workspace-labels";
import { useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  createWorkspaceLabelManagerModel,
  useWorkspaceLabelProjection,
  workspaceLabels,
} from "@/workspace-labels";
import { HostStatusDot } from "~/components/host-status-dot";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Spinner } from "~/components/ui/spinner";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "~/sidebar/workspace-labels-menu";

type ManagerModel = ReturnType<typeof createWorkspaceLabelManagerModel>;
type ManagerState = ReturnType<ManagerModel["snapshot"]>;

/** packages/app's manager model, kept in sync with the hosts' label projections while open. */
function useManagerModel(open: boolean): { model: ManagerModel; state: ManagerState } {
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
    if (!open) {
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
  }, [hosts, model, snapshots, open]);
  const state = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  return { model, state };
}

function HostSelect({
  hosts,
  serverId,
  onSelect,
}: {
  hosts: HostProfile[];
  serverId: string | null;
  onSelect: (serverId: string) => void;
}) {
  const selected = hosts.find((host) => host.serverId === serverId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="justify-between"
          data-testid="workspace-label-manager-host"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? <HostStatusDot serverId={selected.serverId} /> : null}
            <span className="truncate">{selected?.label || serverId}</span>
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuRadioGroup value={serverId ?? ""} onValueChange={onSelect}>
          {hosts.map((host) => (
            <DropdownMenuRadioItem
              key={host.serverId}
              value={host.serverId}
              data-testid={`workspace-label-manager-host-${host.serverId}`}
            >
              <HostStatusDot serverId={host.serverId} />
              {host.label || host.serverId}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ManagerRow({
  label,
  disabled,
  onEdit,
}: {
  label: WorkspaceLabelDefinition;
  disabled: boolean;
  onEdit: (label: WorkspaceLabelDefinition) => void;
}) {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onEdit(label), [label, onEdit]);
  return (
    <div
      className="group/label flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent"
      data-testid={`workspace-label-manager-label-${label.name}`}
    >
      <WorkspaceLabelDot color={label.color} />
      <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        aria-label={t("workspaceLabels.manage.editLabel", { name: label.name })}
        data-testid={`workspace-label-manager-edit-${label.name}`}
        className="flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/label:opacity-100 max-md:opacity-100 disabled:opacity-30"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

/** The label list: search, host choice, the labels, and the host's status. */
function ManagerListView({
  model,
  state,
  open,
}: {
  model: ManagerModel;
  state: ManagerState;
  open: boolean;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
      model.setQuery(event.target.value);
    },
    [model],
  );
  const selectHost = useCallback((serverId: string) => model.selectHost(serverId), [model]);
  const edit = useCallback((label: WorkspaceLabelDefinition) => model.edit(label), [model]);
  const disabled = state.host?.status !== "online" || state.pending;
  const errorText = state.error ?? state.host?.error ?? null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("workspaceLabels.manage.title")}</DialogTitle>
      </DialogHeader>
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={handleQueryChange}
          placeholder={t("workspaceLabels.manage.search")}
          data-testid="workspace-label-manager-search"
        />
      </InputGroup>
      {hosts.length > 1 ? (
        <HostSelect hosts={hosts} serverId={state.serverId} onSelect={selectHost} />
      ) : null}
      <div className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
        {state.labels.map((label) => (
          <ManagerRow
            key={workspaceLabelKey(label.name)}
            label={label}
            disabled={disabled}
            onEdit={edit}
          />
        ))}
        {state.labels.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("workspaceLabels.manage.empty")}
          </p>
        ) : null}
      </div>
      {state.host?.status === "offline" ? (
        <p className="text-sm text-muted-foreground">{t("workspaceLabels.manage.offline")}</p>
      ) : null}
      {state.host?.status === "unsupported" ? (
        <p className="text-sm text-muted-foreground">{t("workspaceLabels.manage.updateHost")}</p>
      ) : null}
      {errorText ? <p className="text-sm text-destructive-text">{errorText}</p> : null}
    </>
  );
}

/** Renaming or recolouring one label, or deleting it after a confirmation. */
function ManagerEditView({
  model,
  state,
  editing,
  draft,
}: {
  model: ManagerModel;
  state: ManagerState;
  editing: WorkspaceLabelDefinition;
  draft: NonNullable<ManagerState["draft"]>;
}) {
  const { t } = useTranslation();
  const disabled = state.host?.status !== "online" || state.pending;
  const errorText = state.error ?? state.host?.error ?? null;
  const save = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void model.save();
    },
    [model],
  );
  const remove = useCallback(() => {
    void model.delete((affected) =>
      confirmDialog({
        title: t("workspaceLabels.manage.deleteTitle", { name: editing.name }),
        message: t("workspaceLabels.manage.deleteMessage", { count: affected }),
        confirmLabel: t("workspaceLabels.manage.delete"),
        destructive: true,
      }),
    );
  }, [editing.name, model, t]);
  const cancelEdit = useCallback(() => model.cancelEdit(), [model]);
  const setName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => model.setDraftName(event.target.value),
    [model],
  );
  const setColor = useCallback((color: WorkspaceLabelColor) => model.setDraftColor(color), [model]);
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <DialogHeader className="flex-row items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-ml-2"
          onClick={cancelEdit}
          aria-label={t("common.actions.back", { defaultValue: "Back" })}
        >
          <ChevronLeft />
        </Button>
        <DialogTitle>{t("workspaceLabels.manage.edit")}</DialogTitle>
      </DialogHeader>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("workspaceLabels.manage.name")}
        <Input
          key={editing.name}
          defaultValue={draft.name}
          onChange={setName}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-testid="workspace-label-manager-name"
        />
      </label>
      <div className="flex flex-col gap-1.5 text-sm font-medium">
        {t("workspaceLabels.manage.color")}
        <WorkspaceLabelSwatchRow
          value={draft.color}
          onChange={setColor}
          disabled={disabled}
          testId="workspace-label-manager-colors"
        />
      </div>
      {errorText ? <p className="text-sm text-destructive-text">{errorText}</p> : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={remove}
          data-testid="workspace-label-manager-delete"
        >
          {t("workspaceLabels.manage.delete")}
        </Button>
        <Button
          type="submit"
          disabled={disabled || !state.dirty}
          data-testid="workspace-label-manager-save"
        >
          {state.pending ? <Spinner /> : null}
          {t("workspaceLabels.manage.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** packages/app's WorkspaceLabelManagerModal: browse a host's labels, rename or recolour one, delete it. */
export function WorkspaceLabelManagerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { model, state } = useManagerModel(open);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-3 sm:max-w-sm" data-testid="workspace-label-manager">
        {state.draft && state.editing ? (
          <ManagerEditView
            model={model}
            state={state}
            editing={state.editing}
            draft={state.draft}
          />
        ) : (
          <ManagerListView model={model} state={state} open={open} />
        )}
      </DialogContent>
    </Dialog>
  );
}
