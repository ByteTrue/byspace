"""Port packages/app's workspace-labels/manager-modal.tsx to web/src/overrides: one host's label
catalog and the edit view its pencil opens, on the same AdaptiveModalSheet as packages/app. Same
logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

MUTED = "text-xs leading-[normal] text-muted-foreground"
ERROR = "text-xs leading-[normal] text-destructive"

p = Port("workspace-labels/manager-modal.tsx")
p.rep('''import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', '''import { Pencil } from "lucide-react";
''')
p.rep('''import type { Theme } from "@/styles/theme";
''', "")
p.rep('''import { useTranslation } from "react-i18next";
''', '''import { useTranslation } from "react-i18next";
import { cn } from "cn";
''')
p.rep('''/** Grows the pencil to a 44pt target without moving it off the trailing rail. */
const EDIT_HIT_SLOP = (44 - EDIT_ICON_SIZE) / 2;

const ThemedPencil = withUnistyles(Pencil);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
''', "")
p.rep('''        <View style={styles.footer}>''',
      '''        <div className="flex flex-1 flex-row items-center justify-between gap-2">''')
p.rep('''            style={styles.saveButton}''', '''            className="min-w-28"''')
p.rep('''          </Button>
        </View>
      ) : undefined,''', '''          </Button>
        </div>
      ) : undefined,''')
p.rep('''          <View style={styles.list}>''', '''          <div className="flex flex-col gap-1">''')
p.rep('''              <Text style={styles.muted}>{t("workspaceLabels.manage.empty")}</Text>
            ) : null}
          </View>''', f'''              <span className="{MUTED}">{{t("workspaceLabels.manage.empty")}}</span>
            ) : null}}
          </div>''')
p.rep('''            <Text style={styles.muted}>{t("workspaceLabels.manage.offline")}</Text>''',
      f'''            <span className="{MUTED}">{{t("workspaceLabels.manage.offline")}}</span>''')
p.rep('''            <Text style={styles.muted}>{t("workspaceLabels.manage.updateHost")}</Text>''',
      f'''            <span className="{MUTED}">{{t("workspaceLabels.manage.updateHost")}}</span>''')
p.rep('''            <Text style={styles.error} testID="workspace-label-manager-error">
              {state.error ?? state.host?.error}
            </Text>''', f'''            <span className="{ERROR}" data-testid="workspace-label-manager-error">
              {{state.error ?? state.host?.error}}
            </span>''')
# The row: hover on the outer element, the pencil fades in rather than mounting.
p.rep('''  const editStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.rowEdit,
      !revealed && styles.rowEditHidden,
      pressed && styles.rowEditPressed,
    ],
    [revealed],
  );

  return (
    <View
      style={styles.row}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`workspace-label-manager-label-${label.name}`}
    >
      <WorkspaceLabelDot color={label.color} />
      <Text style={styles.rowName} numberOfLines={1}>
        {label.name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspaceLabels.manage.editLabel", { name: label.name })}
        disabled={disabled}
        hitSlop={EDIT_HIT_SLOP}
        onPress={edit}
        pointerEvents={revealed ? "auto" : "none"}
        style={editStyle}
        testID={`workspace-label-manager-edit-${label.name}`}
      >
        <ThemedPencil size={EDIT_ICON_SIZE} uniProps={mutedMapping} />
      </Pressable>
    </View>
  );''', '''  // A fixed 32px row, so the pencil appearing cannot resize it under the pointer.
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
  );''')
p.rep('''        <Text style={styles.error} testID="workspace-label-manager-error">
          {error}
        </Text>''', f'''        <span className="{ERROR}" data-testid="workspace-label-manager-error">
          {{error}}
        </span>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("one host's label catalog and the label edit view, on AdaptiveModalSheet; DOM view.",
        "workspace-label-manager.py")
