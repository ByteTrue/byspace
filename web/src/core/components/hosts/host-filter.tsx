// Port of archive/expo-app:packages/app/src/components/hosts/host-filter.tsx: the host filter pill over the shared host picker; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/host-filter.py; edit it directly.
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ChevronDown, Server } from "lucide-react";
import type { HostProfile } from "@/types/host-connection";
import {
  ALL_HOSTS_OPTION_ID,
  getHostPickerLabel,
  HostPicker,
  HostStatusDotSlot,
} from "@/components/hosts/host-picker";
import { Button } from "~/components/ui/button";

export interface HostFilterProps {
  hosts: HostProfile[];
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  /**
   * Offer "All hosts". Off for a surface that acts on exactly one host's data — the label
   * manager edits a single host's catalog, so "all" is not an answer it could carry out.
   */
  includeAllHost?: boolean;
  triggerTestID?: string;
  hostOptionTestID?: (serverId: string) => string;
}

/**
 * The "All hosts / <host>" filter pill shared by the History and Schedules
 * screens: an anchored HostPicker with `includeAllHost`, hidden by the caller
 * when only one host exists. Copies the History layout exactly.
 */
export function HostFilter({
  hosts,
  selectedHost,
  onSelectHost,
  includeAllHost = true,
  triggerTestID,
  hostOptionTestID,
}: HostFilterProps): ReactElement {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);

  const selectedHostLabel = useMemo(
    () => getHostPickerLabel(hosts, selectedHost, { includeAllHost }),
    [hosts, includeAllHost, selectedHost],
  );

  const handleFilterOpen = useCallback(() => setIsFilterOpen(true), []);

  return (
    <HostPicker
      hosts={hosts}
      value={selectedHost}
      onSelect={onSelectHost}
      open={isFilterOpen}
      onOpenChange={setIsFilterOpen}
      anchorRef={filterAnchorRef}
      includeAllHost={includeAllHost}
      searchable={false}
      title="Filter by host"
      desktopPlacement="bottom-start"
      hostOptionTestID={hostOptionTestID}
    >
      <div ref={filterAnchorRef} className="flex self-start">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handleFilterOpen}
          data-testid={triggerTestID}
          aria-label={`Filter: ${selectedHostLabel}`}
          className="self-start"
        >
          {selectedHost === ALL_HOSTS_OPTION_ID ? (
            <Server size={14} className="text-muted-foreground" />
          ) : (
            <HostStatusDotSlot serverId={selectedHost} />
          )}
          <span className="truncate text-sm leading-[normal] font-medium text-foreground">
            {selectedHostLabel}
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </div>
    </HostPicker>
  );
}
