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
import { identityColor } from "@/styles/identity-colors";
import { cn } from "cn";
import { keepOpen, type MenuKit } from "~/components/menu-kit";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";

export function WorkspaceLabelDot({ color }: { color: WorkspaceLabelColor }) {
  const style = useMemo(() => ({ backgroundColor: identityColor(color) }), [color]);
  return <span className="size-2 shrink-0 rounded-full" style={style} />;
}

function SwatchButton({
  color,
  selected,
  disabled,
  onChange,
}: {
  color: WorkspaceLabelColor;
  selected: boolean;
  disabled: boolean;
  onChange: (color: WorkspaceLabelColor) => void;
}) {
  const { t } = useTranslation();
  const handleClick = useCallback(() => onChange(color), [color, onChange]);
  const style = useMemo(() => ({ backgroundColor: identityColor(color) }), [color]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={t(`workspaceLabels.colors.${color}`)}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "size-4 rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        selected && "ring-2 ring-foreground",
      )}
      style={style}
    />
  );
}

/** The ten label colours as a row of swatches (packages/app's WorkspaceLabelSwatchRow). */
export function WorkspaceLabelSwatchRow({
  value,
  onChange,
  disabled = false,
  testId,
}: {
  value: WorkspaceLabelColor | null;
  onChange: (color: WorkspaceLabelColor) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" data-testid={testId}>
      {WORKSPACE_LABEL_COLORS.map((color) => (
        <SwatchButton
          key={color}
          color={color}
          selected={color === value}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function stopMenuTypeahead(event: KeyboardEvent) {
  // Radix menus treat letters as typeahead; keep them for the text field.
  if (event.key !== "Escape") event.stopPropagation();
}

function CreateLabelForm({
  serverId,
  workspaceId,
  onCreated,
}: {
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
    <div className="flex w-56 flex-col gap-2 p-1.5">
      <Input
        autoFocus
        value={name}
        onChange={handleNameChange}
        onKeyDown={handleKeyDown}
        placeholder={t("workspaceLabels.name")}
        disabled={offline || pending}
        className="h-7"
        data-testid="workspace-label-picker-create-name"
      />
      <WorkspaceLabelSwatchRow
        value={color}
        onChange={setColor}
        disabled={offline || pending}
        testId="workspace-label-picker-create-colors"
      />
      <Button
        size="sm"
        disabled={offline || !trimmed || pending}
        onClick={submit}
        data-testid="workspace-label-picker-create-submit"
      >
        {pending ? <Spinner /> : null}
        {pending ? t("workspaceLabels.creating") : t("workspaceLabels.createConfirm")}
      </Button>
      {error ? (
        <p className="text-xs text-destructive-text" data-testid="workspace-label-picker-error">
          {error}
        </p>
      ) : null}
    </div>
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
      <WorkspaceLabelDot color={row.color} />
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
      <kit.SubContent className="w-56">
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
              serverId={serverId}
              workspaceId={workspaceId}
              onCreated={closeCreate}
            />
          </kit.SubContent>
        </kit.Sub>
        {snapshot.error ? (
          <p
            className="px-2 py-1.5 text-xs text-destructive-text"
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
