// Override of packages/app/src/components/hosts/host-picker.tsx: the host list as a combobox —
// local daemon first, optional All hosts / Add host / Enable built-in daemon rows, each host with
// its connection dot and, when asked, its active connection and a settings button. Same props;
// the rows are DOM.
import {
  useCallback,
  useMemo,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Plus, Server, Settings } from "lucide-react";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  getHostPickerLabel,
} from "@/components/hosts/host-picker-constants";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeSnapshot, type ActiveConnection } from "@/runtime/host-runtime";
import { ICON_SIZE } from "@/styles/theme";
import { orderHostsLocalFirst } from "@/types/host-connection";

export {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  getHostPickerLabel,
};

const SEARCHABLE_THRESHOLD = 10;
type RenderHostOption = NonNullable<ComboboxProps["renderOption"]>;
interface HostPickerHost {
  serverId: string;
  label: string;
}

export function HostStatusDotSlot({ serverId }: { serverId: string }): ReactElement {
  return (
    <span className="flex size-3.5 items-center justify-center">
      <HostStatusDot serverId={serverId} />
    </span>
  );
}

// Standard secure/plain web ports carry no information in the host display.
function formatConnectionEndpoint(endpoint: string): string {
  return endpoint.replace(/:(?:443|80)$/, "");
}

// Socket/pipe transports have no host:port, so they read as "Local".
function formatActiveConnectionLabel(connection: ActiveConnection): string {
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return "Local";
  }
  return formatConnectionEndpoint(connection.endpoint);
}

export interface HostPickerOptionProps {
  serverId: string;
  label: string;
  showActiveConnection: boolean;
  selected?: boolean;
  active: boolean;
  onPress: () => void;
  onOpenHostSettings?: (serverId: string) => void;
  testID?: string;
}

export function HostPickerOption({
  serverId,
  label,
  showActiveConnection,
  selected,
  active,
  onPress,
  onOpenHostSettings,
  testID,
}: HostPickerOptionProps): ReactElement {
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const connectionLabel =
    showActiveConnection && activeConnection
      ? formatActiveConnectionLabel(activeConnection)
      : undefined;
  const leadingSlot = useMemo(() => <HostStatusDotSlot serverId={serverId} />, [serverId]);
  const handleSettingsPress = useCallback(
    (event: MouseEvent) => {
      // The gear sits inside the row; the press is the gear's, not the row's.
      event.stopPropagation();
      onOpenHostSettings?.(serverId);
    },
    [onOpenHostSettings, serverId],
  );
  const trailingSlot = useMemo(() => {
    if (!onOpenHostSettings) return undefined;
    return (
      // A span, not a button: the row is already a button.
      <span
        role="button"
        tabIndex={-1}
        onClick={handleSettingsPress}
        aria-label={`Open ${label} settings`}
        // packages/app: the bare 14px gear, no padding (its 8px hit slop is invisible), no hover tint
        className="flex text-muted-foreground"
      >
        <Settings size={ICON_SIZE.sm} />
      </span>
    );
  }, [handleSettingsPress, label, onOpenHostSettings]);

  return (
    <ComboboxItem
      label={label}
      description={connectionLabel}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

const SYSTEM_HOST_PICKER_OPTION_LABELS: Record<"add" | "all" | "enableBuiltInDaemon", string> = {
  add: "Add host",
  all: "All hosts",
  enableBuiltInDaemon: "Enable built-in daemon",
};

function SystemHostPickerOption({
  active,
  selected,
  onPress,
  kind,
  testID,
}: {
  active: boolean;
  selected?: boolean;
  onPress: () => void;
  kind: "add" | "all" | "enableBuiltInDaemon";
  testID?: string;
}): ReactElement {
  const Icon = kind === "add" ? Plus : Server;
  const leadingSlot = useMemo(
    () => <Icon size={ICON_SIZE.sm} className="text-muted-foreground" />,
    [Icon],
  );
  return (
    <ComboboxItem
      label={SYSTEM_HOST_PICKER_OPTION_LABELS[kind]}
      leadingSlot={leadingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

export interface HostPickerProps {
  hosts: HostPickerHost[];
  value: string;
  onSelect: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  includeAllHost?: boolean;
  includeAddHost?: boolean;
  onAddHost?: () => void;
  includeEnableBuiltInDaemon?: boolean;
  onEnableBuiltInDaemon?: () => void;
  showActiveConnection?: boolean;
  onOpenHostSettings?: (serverId: string) => void;
  searchable?: boolean;
  title?: string;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  addHostTestID?: string;
  hostOptionTestID?: (serverId: string) => string;
  children: ReactNode;
}

export function HostPicker({
  hosts,
  value,
  onSelect,
  open,
  onOpenChange,
  anchorRef,
  includeAllHost,
  includeAddHost,
  onAddHost,
  includeEnableBuiltInDaemon,
  onEnableBuiltInDaemon,
  showActiveConnection,
  onOpenHostSettings,
  searchable,
  title,
  desktopPlacement = "bottom-start",
  desktopMinWidth,
  addHostTestID,
  hostOptionTestID,
  children,
}: HostPickerProps): ReactElement {
  const localServerId = useLocalDaemonServerId();
  const orderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts, localServerId),
    [hosts, localServerId],
  );

  const options = useMemo(() => {
    const hostOptions = orderedHosts.map((host) => ({ id: host.serverId, label: host.label }));
    if (includeAllHost) hostOptions.unshift({ id: ALL_HOSTS_OPTION_ID, label: "All hosts" });
    if (includeAddHost) hostOptions.push({ id: ADD_HOST_OPTION_ID, label: "Add host" });
    if (includeEnableBuiltInDaemon)
      hostOptions.push({
        id: ENABLE_BUILT_IN_DAEMON_OPTION_ID,
        label: "Enable built-in daemon",
      });
    return hostOptions;
  }, [orderedHosts, includeAllHost, includeAddHost, includeEnableBuiltInDaemon]);

  const isSearchable = searchable === true && orderedHosts.length > SEARCHABLE_THRESHOLD;

  const handleSelect = useCallback(
    (id: string) => {
      if (id === ADD_HOST_OPTION_ID) {
        onAddHost?.();
      } else if (id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        onEnableBuiltInDaemon?.();
      } else {
        onSelect(id);
      }
      onOpenChange(false);
    },
    [onAddHost, onEnableBuiltInDaemon, onOpenChange, onSelect],
  );

  const handleOpenHostSettings = useCallback(
    (serverId: string) => {
      onOpenHostSettings?.(serverId);
      onOpenChange(false);
    },
    [onOpenHostSettings, onOpenChange],
  );

  const renderOption = useCallback<RenderHostOption>(
    ({ option, selected, active, onPress }) => {
      if (option.id === ADD_HOST_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="add"
            active={active}
            onPress={onPress}
            testID={addHostTestID}
          />
        );
      }
      if (option.id === ALL_HOSTS_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="all"
            active={active}
            selected={selected}
            onPress={onPress}
            testID={hostOptionTestID?.(option.id)}
          />
        );
      }
      if (option.id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        return (
          <SystemHostPickerOption kind="enableBuiltInDaemon" active={active} onPress={onPress} />
        );
      }
      return (
        <HostPickerOption
          serverId={option.id}
          label={option.label}
          showActiveConnection={showActiveConnection === true}
          selected={selected}
          active={active}
          onPress={onPress}
          onOpenHostSettings={onOpenHostSettings ? handleOpenHostSettings : undefined}
          testID={hostOptionTestID?.(option.id)}
        />
      );
    },
    [
      addHostTestID,
      hostOptionTestID,
      onOpenHostSettings,
      showActiveConnection,
      handleOpenHostSettings,
    ],
  );

  return (
    <>
      {children}
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        renderOption={renderOption}
        searchable={isSearchable}
        searchPlaceholder="Search hosts"
        title={title ?? "Host"}
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
      />
    </>
  );
}
