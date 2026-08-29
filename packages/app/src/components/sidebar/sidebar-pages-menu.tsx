import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { router } from "expo-router";
import { CalendarClock, ChevronDown, History, LayoutGrid } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { buildSchedulesRoute, buildSessionsRoute } from "@/utils/host-routes";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedLayoutGrid = withUnistyles(LayoutGrid);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedHistory = withUnistyles(History);
const ThemedCalendarClock = withUnistyles(CalendarClock);

const historyLeadingIcon = (
  <ThemedHistory size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const schedulesLeadingIcon = (
  <ThemedCalendarClock size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);

interface SidebarPageItem {
  id: string;
  labelKey: string;
  leading: ReactElement;
  buildRoute: () => Parameters<typeof router.push>[0];
  testID: string;
}

/**
 * Every top-level page reachable from the sidebar. Adding a page is one entry here — the sidebar's
 * fixed height does not grow, which is the whole point of collapsing these into a single trigger.
 * Per-item status badges go in `DropdownMenuItem`'s `trailing` slot when a page needs one.
 */
const SIDEBAR_PAGES: readonly SidebarPageItem[] = [
  {
    id: "history",
    labelKey: "sidebar.sections.sessions",
    leading: historyLeadingIcon,
    buildRoute: buildSessionsRoute,
    testID: "sidebar-sessions",
  },
  {
    id: "schedules",
    labelKey: "sidebar.sections.schedules",
    leading: schedulesLeadingIcon,
    buildRoute: buildSchedulesRoute,
    testID: "sidebar-schedules",
  },
];

function SidebarPageMenuItem({
  page,
  onSelect,
}: {
  page: SidebarPageItem;
  onSelect: (page: SidebarPageItem) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(page), [onSelect, page]);

  return (
    <DropdownMenuItem testID={page.testID} leading={page.leading} onSelect={handleSelect}>
      {t(page.labelKey)}
    </DropdownMenuItem>
  );
}

/**
 * Single-row entry point for the sidebar's top-level pages.
 *
 * The trigger deliberately does NOT reflect the current page: one label cannot express both "where
 * I am" and "where I can go", and the page itself already says where you are. Grid icon plus
 * product name plus chevron carry the one meaning it does have — "there are places behind this".
 */
export function SidebarPagesMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The sidebar is user-resizable, so the surface can only line up with the trigger by measuring
  // it. A fixed width leaves the menu visibly narrower than the row that opened it.
  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);

  const handleTriggerLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setTriggerWidth((current) => (current === next ? current : next));
  }, []);

  // Names the destinations without requiring a click, so collapsing two labelled rows into one
  // trigger doesn't hide what the menu contains.
  const contentHint = useMemo(() => SIDEBAR_PAGES.map((page) => t(page.labelKey)).join(" · "), [t]);

  const triggerStyle = useCallback(
    ({ hovered, open: isOpen }: MenuTriggerState) => [
      styles.trigger,
      (hovered || isOpen) && styles.triggerHighlighted,
    ],
    [],
  );

  const handleSelect = useCallback(
    (page: SidebarPageItem) => {
      onNavigate?.();
      router.push(page.buildRoute());
    },
    [onNavigate],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={300} enabledOnDesktop={!open}>
        <TooltipTrigger asChild>
          <View style={styles.container}>
            <DropdownMenuTrigger
              style={triggerStyle}
              onLayout={handleTriggerLayout}
              testID="sidebar-pages"
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.pages.triggerAccessibilityLabel")}
            >
              {({ hovered, open: isOpen }) => {
                const isHighlighted = hovered || isOpen;
                const iconMapping = isHighlighted
                  ? foregroundColorMapping
                  : foregroundMutedColorMapping;
                return (
                  <>
                    <ThemedLayoutGrid size={ICON_SIZE.sm} uniProps={iconMapping} />
                    <Text style={isHighlighted ? styles.labelHighlighted : styles.label}>
                      {t("sidebar.pages.trigger")}
                    </Text>
                    <ThemedChevronDown size={ICON_SIZE.sm} uniProps={iconMapping} />
                  </>
                );
              }}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" offset={8}>
          <Text style={styles.tooltipText}>{contentHint}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="bottom"
        align="start"
        offset={4}
        width={triggerWidth ?? undefined}
        minWidth={triggerWidth ?? undefined}
        testID="sidebar-pages-menu"
      >
        {SIDEBAR_PAGES.map((page) => (
          <SidebarPageMenuItem key={page.id} page={page} onSelect={handleSelect} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  // Mirrors the sidebar project rows' shape so the trigger keeps the icon alignment the two
  // replaced header rows had.
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  triggerHighlighted: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
