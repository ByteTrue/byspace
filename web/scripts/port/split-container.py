#!/usr/bin/env python3
"""Port packages/app's split-container.tsx to web/src/overrides: same logic, DOM + Tailwind view."""
import os

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/components/split-container.tsx")
DST = str(ROOT / "web/src/overrides/components/split-container.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:240]}\n--- found {n}")
    s = s.replace(old, new)


rep('import { View, Text, type LayoutChangeEvent } from "react-native";\n', "")
rep('''import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
''', "")
rep('import { StyleSheet, useUnistyles } from "react-native-unistyles";\n', "")
rep('import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";\n',
    'import { panelTargetSupportsHost } from "@/plugins/workspace-panels/locations";\nimport { cn } from "cn";\n')

# element size hook for the shell and groups
rep('''interface SplitContainerProps {''', '''/** Width or height of an element, kept current with a ResizeObserver. */
function useMeasuredSize(axis: "width" | "height") {
  const [size, setSize] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const update = () => {
        const rect = node.getBoundingClientRect();
        const next = axis === "width" ? rect.width : rect.height;
        setSize((current) => (current === next ? current : next));
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(node);
      observerRef.current = observer;
    },
    [axis],
  );
  return [size, ref] as const;
}

interface SplitContainerProps {''')

# shell width
rep('''  const [workspaceShellWidth, setWorkspaceShellWidth] = useState(0);
''', '''  const [workspaceShellWidth, workspaceShellRef] = useMeasuredSize("width");
''')
rep('''  const mainColumnStyle = styles.mainColumn;
  const explorerSidebarDockStyle = useMemo(
    () => [styles.explorerSidebarDock, { width: explorerSidebarWidth }],
    [explorerSidebarWidth],
  );
  const handleWorkspaceShellLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setWorkspaceShellWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);
''', '''  const explorerSidebarDockStyle = useMemo(
    () => ({ width: explorerSidebarWidth }),
    [explorerSidebarWidth],
  );
''')
rep('''        <View style={styles.workspaceShell} onLayout={handleWorkspaceShellLayout}>
          <View style={mainColumnStyle}>''', '''        <div ref={workspaceShellRef} className="flex min-h-0 min-w-0 flex-1 flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 shrink flex-col">''')
rep('''            ) : null}
          </View>
          {renderExplorerSidebarDock && explorerSidebarPane ? (''', '''            ) : null}
          </div>
          {renderExplorerSidebarDock && explorerSidebarPane ? (''')
rep('''              <View style={explorerSidebarDockStyle}>
                <ExplorerSidebarDock''', '''              <div
                className="flex min-h-0 min-w-60 shrink-0 flex-col bg-sidebar"
                style={explorerSidebarDockStyle}
              >
                <ExplorerSidebarDock''')
rep('''                  headerAction={renderExplorerSidebarHeaderAction?.()}
                />
              </View>
            </>
          ) : null}
        </View>''', '''                  headerAction={renderExplorerSidebarHeaderAction?.()}
                />
              </div>
            </>
          ) : null}
        </div>''')

# drag overlay chip
rep('''  const { t } = useTranslation();
  const { theme } = useUnistyles();

  const chipStyle = useMemo(
    () => [
      styles.dragOverlayChip,
      {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.borderAccent,
      },
    ],
    [theme.colors.surface1, theme.colors.borderAccent],
  );
  const chipLabelStyle = useMemo(
    () => [styles.dragOverlayLabel, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
''', '''  const { t } = useTranslation();
''')
rep('''          <View style={chipStyle}>
            <WorkspaceTabIcon presentation={presentation} active size={14} backdrop="surface1" />
            <Text numberOfLines={1} style={chipLabelStyle}>
              {label}
            </Text>
          </View>''', '''          <div className="flex max-w-[200px] items-center gap-2 rounded-md border bg-card px-3 py-1">
            <WorkspaceTabIcon presentation={presentation} active size={14} backdrop="surface1" />
            <span className="min-w-0 shrink truncate text-sm text-foreground">{label}</span>
          </div>''')

# group child: flex grow from props; preview resizes write to the node directly
rep('''function SplitGroupChild({
  resizeFlex,
  index,
  hidden,
  children,
}: {
  resizeFlex: SharedValue<number[]>;
  index: number;
  hidden: boolean;
  children: ReactNode;
}) {
  const resizeStyle = useAnimatedStyle(() => ({
    flexGrow: resizeFlex.value[index] ?? 0,
  }));
  const childStyle = useMemo(
    () => [
      styles.groupChild,
      {
        flexShrink: hidden ? 0 : 1,
        flexBasis: 0,
        ...(hidden ? { width: 0, height: 0 } : {}),
      },
    ],
    [hidden],
  );
  return (
    <Animated.View
      style={[childStyle, resizeStyle]}
      testID={hidden ? "split-group-child-hidden" : "split-group-child"}
    >
      {children}
    </Animated.View>
  );
}''', '''function SplitGroupChild({
  flexGrow,
  hidden,
  nodeRef,
  children,
}: {
  flexGrow: number;
  hidden: boolean;
  nodeRef: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const style = useMemo(
    () => ({
      flexGrow,
      flexShrink: hidden ? 0 : 1,
      flexBasis: 0,
      ...(hidden ? { width: 0, height: 0 } : {}),
    }),
    [flexGrow, hidden],
  );
  return (
    <div
      ref={nodeRef}
      className="flex min-h-0 min-w-0 flex-col"
      style={style}
      data-testid={hidden ? "split-group-child-hidden" : "split-group-child"}
    >
      {children}
    </div>
  );
}''')

rep('''  const [groupContainerSize, setGroupContainerSize] = useState(0);
  const groupId = node.kind === "group" ? node.group.id : null;
  const groupDirection = node.kind === "group" ? node.group.direction : null;
''', '''  const groupId = node.kind === "group" ? node.group.id : null;
  const groupDirection = node.kind === "group" ? node.group.direction : null;
  const [groupContainerSize, groupRef] = useMeasuredSize(
    groupDirection === "horizontal" ? "width" : "height",
  );
''')
rep('''  const resizeFlex = useSharedValue(visibleFlex);
  useEffect(() => {
    resizeFlex.value = visibleFlex;
  }, [resizeFlex, visibleFlex]);
  const previewResizeSplit = useCallback(
    (_groupId: string, sizes: number[]) => {
      resizeFlex.value = resolveVisibleGroupFlex(groupChildren, sizes, maximizedPaneId);
    },
    [groupChildren, maximizedPaneId, resizeFlex],
  );
  const handleGroupLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextSize =
        groupDirection === "horizontal"
          ? event.nativeEvent.layout.width
          : event.nativeEvent.layout.height;
      setGroupContainerSize((current) => (current === nextSize ? current : nextSize));
    },
    [groupDirection],
  );

  const groupStyle = useMemo(
    () => [
      styles.group,
      groupDirection === "horizontal" ? styles.groupHorizontal : styles.groupVertical,
    ],
    [groupDirection],
  );
''', '''  // A drag previews by writing flex-grow straight onto the children, so the panes inside do not
  // re-render on every pointer move; the store commit on release renders the same values.
  const childNodesRef = useRef<(HTMLDivElement | null)[]>([]);
  const childRefCallbacks = useMemo(
    () =>
      groupChildren.map((_child, index) => (childNode: HTMLDivElement | null) => {
        childNodesRef.current[index] = childNode;
      }),
    [groupChildren],
  );
  const previewResizeSplit = useCallback(
    (_groupId: string, sizes: number[]) => {
      const flex = resolveVisibleGroupFlex(groupChildren, sizes, maximizedPaneId);
      childNodesRef.current.forEach((childNode, index) => {
        if (childNode) childNode.style.flexGrow = String(flex[index] ?? 0);
      });
    },
    [groupChildren, maximizedPaneId],
  );
''')
rep('''    <View style={groupStyle} onLayout={handleGroupLayout}>
      {node.group.children.map((child, index) => (
        <Fragment key={getNodeKey(child)}>
          <SplitGroupChild
            resizeFlex={resizeFlex}
            index={index}
            hidden={isSplitNodeHiddenForPresentation(child, maximizedPaneId)}
          >''', '''    <div
      ref={groupRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        groupDirection === "horizontal" ? "flex-row" : "flex-col",
      )}
    >
      {node.group.children.map((child, index) => (
        <Fragment key={getNodeKey(child)}>
          <SplitGroupChild
            flexGrow={visibleFlex[index] ?? 0}
            hidden={isSplitNodeHiddenForPresentation(child, maximizedPaneId)}
            nodeRef={childRefCallbacks[index]}
          >''')
rep('''          ) : null}
        </Fragment>
      ))}
    </View>
  );
}''', '''          ) : null}
        </Fragment>
      ))}
    </div>
  );
}''')

# pane view
rep('''  const paneRef = useRef<View | null>(null);''', '''  const paneRef = useRef<HTMLDivElement | null>(null);''')
rep('''      <View
        ref={paneRef}
        collapsable={false}
        style={styles.pane}
        testID={`workspace-pane-${pane.id}`}
      >
        <View style={styles.paneTabs}>
          <WorkspaceDesktopTabsRow''', '''      <div
        ref={paneRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        data-testid={`workspace-pane-${pane.id}`}
      >
        <div className="relative min-w-0">
          <WorkspaceDesktopTabsRow''')
rep('''            onExitFocusMode={onExitFocusMode}
          />
        </View>

        <View style={styles.paneContent}>
          <WorkspacePanelHost''', '''            onExitFocusMode={onExitFocusMode}
          />
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspacePanelHost''')
rep('''          <SplitDropZone paneId={pane.id} active={showDropZones} preview={dropPreview} />
        </View>
      </View>
    </RenderProfile>''', '''          <SplitDropZone paneId={pane.id} active={showDropZones} preview={dropPreview} />
        </div>
      </div>
    </RenderProfile>''')

start = s.index("const styles = StyleSheet.create((theme) => ({")
s = s[:start].rstrip() + "\n"
for needle in ["<View", "<Text", "styles.", "StyleSheet", "Animated", "useUnistyles", "LayoutChangeEvent"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-120:i+120]}")
s = """// Override of packages/app/src/components/split-container.tsx. The drag-and-drop, split, resize,
// maximize and explorer-dock logic is the Expo file's; the view is DOM and Tailwind.
// Generated from the Expo file by web/scripts/port/split-container.py.\n// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n""" + s
os.makedirs(os.path.dirname(DST), exist_ok=True)
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
