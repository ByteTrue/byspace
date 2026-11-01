"""Port packages/app's components/hosts/host-filter.tsx to web/src/overrides: the "All hosts / <host>"
pill that opens the shared host picker. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("components/hosts/host-filter.tsx")
p.rep('''import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, Server } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { HostProfile } from "@/types/host-connection";
import type { Theme } from "@/styles/theme";
''', '''import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ChevronDown, Server } from "lucide-react";
import type { HostProfile } from "@/types/host-connection";
''')
p.rep('''const ThemedServer = withUnistyles(Server);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

''', "")
p.rep('''  const filterAnchorRef = useRef<View>(null);''', '''  const filterAnchorRef = useRef<HTMLDivElement>(null);''')
p.rep('''  const filterTriggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      Boolean(hovered) && styles.filterTriggerHovered,
      pressed && styles.filterTriggerPressed,
    ],
    [],
  );

''', "")
p.rep('''      <View ref={filterAnchorRef} collapsable={false} style={styles.filterTriggerWrap}>
        <Pressable
          onPress={handleFilterOpen}
          style={filterTriggerStyle}
          testID={triggerTestID}
          accessibilityRole="button"
          accessibilityLabel={`Filter: ${selectedHostLabel}`}
        >
          {selectedHost === ALL_HOSTS_OPTION_ID ? (
            <ThemedServer size={14} uniProps={mutedColorMapping} />
          ) : (
            <HostStatusDotSlot serverId={selectedHost} />
          )}
          <Text style={styles.filterTriggerText} numberOfLines={1}>
            {selectedHostLabel}
          </Text>
          <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
        </Pressable>
      </View>''', '''      <div ref={filterAnchorRef} className="flex self-start">
        <button
          type="button"
          onClick={handleFilterOpen}
          className="flex flex-row items-center gap-1.5 self-start rounded-md border bg-card px-3 py-1.5 outline-none hover:bg-muted active:bg-(--surface-3)"
          data-testid={triggerTestID}
          aria-label={`Filter: ${selectedHostLabel}`}
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
        </button>
      </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the host filter pill over the shared host picker; DOM view.", "host-filter.py")
