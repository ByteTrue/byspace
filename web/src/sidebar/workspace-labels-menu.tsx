import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Plus, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  normalizeWorkspaceLabelName,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@bytetrue/protocol/workspace-labels";
import {
  createWorkspaceLabelPickerModel,
  useWorkspaceLabelProjection,
  workspaceLabelErrorMessage,
  workspaceLabels,
  type WorkspaceLabelPickerRow,
} from "@/workspace-labels";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "@/workspace-labels/swatch";
import { keepOpen, type MenuKit } from "~/components/menu-kit";
import { Spinner } from "~/components/ui/spinner";

function stopMenuTypeahead(event: KeyboardEvent) {
  // Radix menus treat letters as typeahead; keep them for the text field.
  if (event.key !== "Escape") event.stopPropagation();
}

/**
 * The Expo app's WorkspaceLabelCreatePage: the menu's own text field, the swatch row on the rows'
 * text rail, a separator and a Create row. The field is focused on open (the Expo app asks for
 * that too, but its menu engine never focused it on the web).
 */
function CreateLabelForm({
  kit,
  serverId,
  workspaceId,
  onCreated,
}: {
  kit: MenuKit;
  serverId: string;
  workspaceId: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { targetHost: host } = useWorkspaceLabelProjection(serverId);
  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceLabelColor>(WORKSPACE_LABEL_COLORS[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = host?.status !== "online";
  const trimmed = normalizeWorkspaceLabelName(name);
  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const submit = useCallback(() => {
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    workspaceLabels
      .setAssignment({ serverId, workspaceId, label: { name: trimmed, color }, assigned: true })
      .then(() => {
        setName("");
        onCreated();
        return null;
      })
      .catch((cause: unknown) => setError(workspaceLabelErrorMessage(cause)))
      .finally(() => setPending(false));
  }, [color, onCreated, pending, serverId, trimmed, workspaceId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      stopMenuTypeahead(event);
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <>
      {/* The Expo app's MenuTextField: a row-sized box in the row fill, its text on the rows' rail */}
      <div className="mx-1 flex min-h-7 items-center rounded-md border bg-muted px-2 py-1 focus-within:border-input">
        <input
          autoFocus
          value={name}
          onChange={handleNameChange}
          onKeyDown={handleKeyDown}
          placeholder={t("workspaceLabels.name")}
          aria-label={t("workspaceLabels.name")}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={offline || pending}
          className="min-w-0 flex-1 bg-transparent p-0 text-xs leading-[18px] text-foreground outline-none placeholder:text-muted-foreground"
          data-testid="workspace-label-picker-create-name"
        />
      </div>
      <div className="px-[13px] py-2">
        <WorkspaceLabelSwatchRow
          value={color}
          onChange={setColor}
          disabled={offline || pending}
          testID="workspace-label-picker-create-colors"
        />
      </div>
      <kit.Separator />
      <kit.Item
        disabled={offline || !trimmed}
        onSelect={keepOpen(submit)}
        data-testid="workspace-label-picker-create-submit"
      >
        {pending ? <Spinner /> : null}
        {pending ? t("workspaceLabels.creating") : t("workspaceLabels.createConfirm")}
      </kit.Item>
      {error ? (
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          data-testid="workspace-label-picker-error"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

function LabelRow({
  kit,
  row,
  offline,
  pending,
  onToggle,
}: {
  kit: MenuKit;
  row: WorkspaceLabelPickerRow;
  offline: boolean;
  pending: boolean;
  onToggle: (row: WorkspaceLabelPickerRow) => void;
}) {
  return (
    <kit.CheckboxItem
      checked={row.assigned}
      disabled={offline || pending}
      onSelect={keepOpen(() => onToggle(row))}
      data-testid={`workspace-label-picker-row-${row.name}`}
    >
      {/* The Expo app's menu leading slot: the dot centred in a 16px box, on the icons' rail */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <WorkspaceLabelDot color={row.color} />
      </span>
      <span className="truncate">{row.name}</span>
      {pending ? <Spinner className="ml-auto" /> : null}
    </kit.CheckboxItem>
  );
}

/** The Labels submenu of a workspace menu: assign existing labels, or create one and assign it. */
export function WorkspaceLabelsSubmenu({
  kit,
  serverId,
  workspaceId,
  assignedLabels,
  testId,
}: {
  kit: MenuKit;
  serverId: string;
  workspaceId: string;
  assignedLabels: readonly string[];
  testId?: string;
}) {
  const { t } = useTranslation();
  const { labels, targetHost: host } = useWorkspaceLabelProjection(serverId);
  const model = useMemo(
    () =>
      createWorkspaceLabelPickerModel({
        mutate: ({ label, assigned }) =>
          workspaceLabels.setAssignment({ serverId, workspaceId, label, assigned }),
      }),
    [serverId, workspaceId],
  );
  useEffect(() => {
    model.sync({ labels, assigned: assignedLabels, online: host?.status === "online" });
  }, [assignedLabels, host?.status, labels, model]);
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const pendingNames = useMemo(() => new Set(snapshot.pendingNames), [snapshot.pendingNames]);
  const offline = !snapshot.online;
  const toggle = useCallback(
    (row: WorkspaceLabelPickerRow) =>
      void model.toggle({ name: row.name, color: row.color }, !row.assigned),
    [model],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  return (
    <kit.Sub>
      <kit.SubTrigger data-testid={testId}>
        <Tag />
        {t("workspaceLabels.title")}
      </kit.SubTrigger>
      <kit.SubContent>
        {snapshot.rows.map((row) => (
          <LabelRow
            key={row.name.toLocaleLowerCase()}
            kit={kit}
            row={row}
            offline={offline}
            pending={pendingNames.has(row.name.toLocaleLowerCase())}
            onToggle={toggle}
          />
        ))}
        {snapshot.rows.length > 0 ? <kit.Separator /> : null}
        <kit.Sub open={createOpen} onOpenChange={setCreateOpen}>
          <kit.SubTrigger disabled={offline} data-testid="workspace-label-picker-create">
            <Plus />
            {t("workspaceLabels.create")}
          </kit.SubTrigger>
          <kit.SubContent>
            <CreateLabelForm
              kit={kit}
              serverId={serverId}
              workspaceId={workspaceId}
              onCreated={closeCreate}
            />
          </kit.SubContent>
        </kit.Sub>
        {snapshot.error ? (
          <p
            className="px-2 py-1.5 text-xs text-destructive"
            data-testid="workspace-label-picker-error"
          >
            {snapshot.error}
          </p>
        ) : null}
        {host?.status === "unsupported" ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("workspaceLabels.updateHostUse")}
          </p>
        ) : null}
      </kit.SubContent>
    </kit.Sub>
  );
}
