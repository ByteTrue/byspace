"""Port packages/app's Schedules page to web/src/overrides: screens/schedules-screen.tsx and the
schedule components it renders (components/schedules/schedules-table.tsx, schedule-row.tsx,
schedule-form-sheet.tsx, cadence-editor.tsx). Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

ERROR_TEXT = "text-xs leading-[normal] text-red-300"
OPTION_ICON_BOX = "flex size-[18px] items-center justify-center text-muted-foreground"

# ---- cadence-editor.tsx
p = Port("components/schedules/cadence-editor.tsx")
p.rep('''import { useCallback, useMemo, useReducer, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { useCallback, useMemo, useReducer, useState, type ReactNode } from "react";
''')
p.rep('''    feedback = <Text style={styles.error}>{effectiveError}</Text>;''',
      f'''    feedback = <span className="{ERROR_TEXT}">{{effectiveError}}</span>;''')
p.rep('''    feedback = <Text style={styles.preview}>{preview}</Text>;''',
      '''    feedback = <span className="text-xs leading-[normal] text-muted-foreground">{preview}</span>;''')
p.rep('''      <View style={styles.stack}>''', '''      <div className="flex flex-col gap-3">''')
# packages/app's mono style never reached the text (its FormTextInput puts `style` on the wrapper),
# so the cron shows in the UI font there; same here.
p.rep('''          spellCheck={false}
          style={styles.cronInput}
        />
        {feedback}
      </View>''', '''          spellCheck={false}
        />
        {feedback}
      </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the cadence field of the schedule form; DOM view.", "schedules.py")

# ---- schedule-row.tsx
p = Port("components/schedules/schedule-row.tsx")
p.rep('''import { MoreVertical, Pause, Pencil, Play, RotateCw, Trash2 } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', '''import { MoreVertical, Pause, Pencil, Play, RotateCw, Trash2 } from "lucide-react";
import { useCallback, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { cn } from "cn";
''')
p.rep('''import type { Theme } from "@/styles/theme";
''', "")
p.rep('''// Themed lucide wrappers — module-scope so only the icon re-renders on theme
// change (never call useUnistyles in render). See docs/unistyles.md.
const ThemedPencil = withUnistyles(Pencil);
const ThemedPause = withUnistyles(Pause);
const ThemedPlay = withUnistyles(Play);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedKebab = withUnistyles(MoreVertical);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

''', "")
p.rep('''/** Small provider glyph. Reads the icon color off a StyleSheet object so the
 * dynamic component (getProviderIcon) stays compliant without useUnistyles. */''',
      '''/** Small provider glyph in the muted colour. */''')
p.rep(''' * Hover lives on the outer plain View (docs/hover.md): the inner Pressable owns
 * press, the nested kebab Pressable never fights it, and the row background
 * highlights without reflow.''', ''' * The row is a focusable div rather than a button, because it holds the kebab
 * button; it presses on click, Enter and Space. Hovering highlights it on desktop.''')
p.rep('''  const Icon = getProviderIcon(provider, serverId);
  return <Icon size={PROVIDER_ICON_SIZE} color={styles.providerIcon.color} />;
}''', '''  const Icon = getProviderIcon(provider, serverId);
  return (
    <span className="flex text-muted-foreground">
      <Icon size={PROVIDER_ICON_SIZE} color="currentColor" />
    </span>
  );
}

// The row opens the editor; its menu must not.
function stopClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}''')
# The row is a pressable holding the kebab button, so on the web it is a focusable div (a button
# cannot hold a button) that presses on click, Enter and Space, as packages/app's Pressable.
p.rep('''  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
''', '''  const isCompact = useIsCompactFormFactor();
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }
      event.preventDefault();
      onEdit();
    },
    [onEdit],
  );
''')
p.between('''  const rowStyle = useCallback(''', '''          <View style={styles.leading}>''', '''  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={handleKeyDown}
      aria-label={`Edit ${productName.toLowerCase()} ${title}`}
      data-testid={`schedule-row-${schedule.id}`}
      className={cn(
        settingsStyles.row,
        "relative cursor-pointer gap-3 active:bg-(--surface-3)",
        !isFirst && settingsStyles.rowBorder,
        !isCompact && "hover:bg-muted",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-row items-start gap-3">
''')
p.rep('''          <View style={styles.leading}>
            <ProviderGlyph provider={provider} serverId={serverId} />
          </View>
          <View style={styles.textGroup}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.target} numberOfLines={1}>
              {targetLabel}
            </Text>
            <Text style={settingsStyles.rowHint} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        </View>

        <View style={styles.trailing}>
          <StatusBadge label={badge.label} variant={badge.variant} />''', '''          <div className="flex h-5 w-4 shrink-0 items-center justify-center">
            <ProviderGlyph provider={provider} serverId={serverId} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={cn(settingsStyles.rowTitle, "truncate")}>{title}</span>
            <span className="mt-1 truncate text-sm leading-[normal] text-muted-foreground">
              {targetLabel}
            </span>
            <span className={cn(settingsStyles.rowHint, "truncate")}>{meta}</span>
          </div>
        </div>

        <div className="flex flex-row items-center gap-2" onClick={stopClickPropagation}>
          <StatusBadge label={badge.label} variant={badge.variant} />''')
p.rep('''            onDelete={onDelete}
          />
        </View>
      </Pressable>
    </View>
  );
}''', '''            onDelete={onDelete}
          />
        </div>
    </div>
  );
}''')
p.rep('''const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const pauseLeading = <ThemedPause size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const resumeLeading = <ThemedPlay size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const runLeading = <ThemedRotateCw size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const deleteLeading = <ThemedTrash2 size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;''',
      '''const editLeading = <Pencil size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const pauseLeading = <Pause size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const resumeLeading = <Play size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const runLeading = <RotateCw size={MENU_ICON_SIZE} className="text-muted-foreground" />;
const deleteLeading = <Trash2 size={MENU_ICON_SIZE} className="text-destructive" />;''')
p.rep('''function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={MENU_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

''', "")
p.rep('''      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityLabel={`${productName} actions`}
        testID={`schedule-kebab-${schedule.id}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>''', '''      <DropdownMenuTrigger
        accessibilityLabel={`${productName} actions`}
        testID={`schedule-kebab-${schedule.id}`}
        className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreVertical size={MENU_ICON_SIZE} />
      </DropdownMenuTrigger>''')
p.cut_from('''function kebabTriggerStyle({''')
p.check()
p.write("one schedule in the Schedules list; DOM view.", "schedules.py")

# ---- schedules-table.tsx
p = Port("components/schedules/schedules-table.tsx")
p.rep('''import { useCallback, useState, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { useCallback, useState, type ReactElement } from "react";
''')
# Full-width list padding matching the History screen.
p.rep('''    <View style={styles.listContent} testID="schedules-table">
      <View style={settingsStyles.card}>''', '''    <div className="px-3 md:px-6" data-testid="schedules-table">
      <div className={settingsStyles.card}>''')
p.rep('''        ))}
      </View>
    </View>
  );
}''', '''        ))}
      </div>
    </div>
  );
}''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the Schedules list card; DOM view.", "schedules.py")

# ---- schedules-screen.tsx
p = Port("screens/schedules-screen.tsx")
p.rep('''import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { CalendarClock, Plus } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { useIsFocused } from "@react-navigation/native";
import { CalendarClock, Plus } from "lucide-react";
''')
p.rep('''import { resolveSchedulesScreenBodyState } from "./schedules-screen-state";''',
      '''import { resolveSchedulesScreenBodyState } from "@/screens/schedules-screen-state";
import { ICON_SIZE } from "@/styles/theme";''')
p.rep('''    return <View style={styles.container} />;''', '''    return <div className={CONTAINER} />;''')
p.rep('''    <View style={styles.container}>
      <MenuHeader title="Schedules" />''', '''    <div className={CONTAINER}>
      <MenuHeader title="Schedules" />''')
p.rep('''        schedule={form.mode === "edit" ? form.schedule : undefined}
      />
    </View>
  );
}''', '''        schedule={form.mode === "edit" ? form.schedule : undefined}
      />
    </div>
  );
}''')
p.rep('''      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>''', '''      <div className={cn(CENTERED, "text-muted-foreground")}>
        <LoadingSpinner size="large" />
      </div>''')
p.rep('''      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load schedules</Text>
        <Button variant="ghost" onPress={onRetry} testID="schedules-retry">
          Try again
        </Button>
      </View>''', '''      <div className={CENTERED}>
        <span className={MUTED_TEXT}>Unable to load schedules</span>
        <Button variant="ghost" onPress={onRetry} testID="schedules-retry">
          Try again
        </Button>
      </div>''')
p.rep('''      <View style={styles.centered}>
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </View>''', '''      <div className={CENTERED}>
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </div>''')
p.rep('''      <View style={styles.filterEmpty}>
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </View>''', '''      <div className={FILTER_EMPTY}>
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </div>''')
p.rep('''    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterRowControls}>''', '''    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-row items-center justify-between gap-3 px-3 pt-4 md:px-6">
        <div className="flex shrink flex-row flex-wrap items-center gap-3">''')
p.rep('''            testID="schedules-status-filter"
          />
        </View>''', '''            testID="schedules-status-filter"
          />
        </div>''')
p.rep('''          New schedule
        </Button>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="schedules-list"
      >
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        {schedulesContent}
      </ScrollView>
    </View>
  );
}''', '''          New schedule
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]"
        data-testid="schedules-list"
      >
        <div className="flex grow flex-col gap-3 pt-4 pb-6">
          {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
          {schedulesContent}
        </div>
      </div>
    </div>
  );
}''')
p.rep('''    <View style={styles.emptyState} testID={testID}>
      <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>No active schedules</Text>
        <Text style={styles.emptyDescription}>Schedules run agents on a cadence.</Text>''', '''    <div className="flex w-full max-w-[420px] flex-col items-center gap-4" data-testid={testID}>
      <CalendarClock size={ICON_SIZE.lg} className="text-muted-foreground" />
      <div className="flex flex-col items-center gap-2">
        <span className={EMPTY_TITLE}>No active schedules</span>
        <span className={MUTED_TEXT}>Schedules run agents on a cadence.</span>''')
p.rep('''          label="See docs"
        />
      </View>''', '''          label="See docs"
        />
      </div>''')
p.rep('''        New schedule
      </Button>
    </View>
  );
}

function SchedulesEndedEmptyState(): ReactElement {
  return (
    <View style={styles.filterEmpty}>
      <View style={styles.endedEmptyState}>
        <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <Text style={styles.emptyTitle}>No ended schedules</Text>
      </View>
    </View>
  );
}''', '''        New schedule
      </Button>
    </div>
  );
}

function SchedulesEndedEmptyState(): ReactElement {
  return (
    <div className={FILTER_EMPTY}>
      <div className="flex flex-col items-center gap-3">
        <CalendarClock size={ICON_SIZE.lg} className="text-muted-foreground" />
        <span className={EMPTY_TITLE}>No ended schedules</span>
      </div>
    </div>
  );
}''')
p.rep('''    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="schedules-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {`${error.serverName}: Could not load schedules`}
          </Text>
        ))}
      </View>
    </View>''', f'''    <div className="px-3 md:px-6">
      <div
        className="flex flex-col gap-1 rounded-[10px] border p-3"
        data-testid="schedules-host-errors"
      >
        {{errors.map((error) => (
          <span key={{error.serverId}} className="{ERROR_TEXT}">
            {{`${{error.serverName}}: Could not load schedules`}}
          </span>
        ))}}
      </div>
    </div>''')
p.cut_from("const styles = StyleSheet.create")
p.rep('''import type { ScheduleSummary } from "@bytetrue/protocol/schedule/types";
''', '''import type { ScheduleSummary } from "@bytetrue/protocol/schedule/types";
import { cn } from "cn";
''')
p.s += '''
const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const CENTERED = "flex flex-1 flex-col items-center justify-center gap-6 p-6";
const FILTER_EMPTY = "flex grow flex-col items-center justify-center px-3 py-6 md:px-6";
const EMPTY_TITLE = "text-center text-sm leading-[normal] font-normal text-foreground";
const MUTED_TEXT = "text-center text-sm leading-[normal] text-muted-foreground";
'''
p.check()
p.write("the Schedules page; DOM view.", "schedules.py")

# ---- schedule-form-sheet.tsx
p = Port("components/schedules/schedule-form-sheet.tsx")
p.rep('''import { Text, View } from "react-native";
import { Brain, Folder, GitBranch } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { Brain, Folder, GitBranch } from "lucide-react";
import { cn } from "cn";
''')
p.rep('''import { createControlGeometry, type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";''', '''import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput, formInputClassName } from "@/components/ui/form-field";''')
p.rep('''      <View style={styles.footer}>
        <Button variant="secondary" onPress={onClose} disabled={isSubmitting}>''', '''      <div className="flex flex-1 flex-row justify-end gap-2">
        <Button variant="secondary" onPress={onClose} disabled={isSubmitting}>''')
p.rep('''          {mode === "edit" ? "Save changes" : "Create schedule"}
        </Button>
      </View>
    ),''', '''          {mode === "edit" ? "Save changes" : "Create schedule"}
        </Button>
      </div>
    ),''')
p.rep('''        {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
      </>
    );
  }''', f'''        {{state.submitError ? <span className="{ERROR_TEXT}">{{state.submitError}}</span> : null}}
      </>
    );
  }}''')
p.rep('''      {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
    </>
  );
}''', f'''      {{state.submitError ? <span className="{ERROR_TEXT}">{{state.submitError}}</span> : null}}
    </>
  );
}}''')
# textAlignVertical is React Native's; a textarea starts its text at the top. The 96px minimum
# height never reached packages/app's text field either (`style` goes to the wrapper), so the field
# is its four rows: 88px on desktop.
p.rep('''          placeholder="What should the agent do each run?"
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />''', '''          placeholder="What should the agent do each run?"
          multiline
          numberOfLines={4}
        />''')
p.rep('''      <View style={styles.optionIconBox}>
        {state.effectiveIsolation === "worktree" ? (
          <GitBranch size={16} color={styles.providerIcon.color} />
        ) : (
          <Folder size={16} color={styles.providerIcon.color} />
        )}
      </View>''', f'''      <span className="{OPTION_ICON_BOX}">
        {{state.effectiveIsolation === "worktree" ? <GitBranch size={{16}} /> : <Folder size={{16}} />}}
      </span>''')
p.rep('''      <View style={styles.optionIconBox}>
        {option.value === "worktree" ? (
          <GitBranch size={16} color={styles.providerIcon.color} />
        ) : (
          <Folder size={16} color={styles.providerIcon.color} />
        )}
      </View>''', f'''      <span className="{OPTION_ICON_BOX}">
        {{option.value === "worktree" ? <GitBranch size={{16}} /> : <Folder size={{16}} />}}
      </span>''')
p.rep('''      <View style={styles.optionIconBox}>
        <Folder size={16} color={styles.providerIcon.color} />
      </View>''', f'''      <span className="{OPTION_ICON_BOX}">
        <Folder size={{16}} />
      </span>''')
p.rep('''      <View style={styles.optionIconBox}>
        <Brain size={16} color={styles.providerIcon.color} />
      </View>''', f'''      <span className="{OPTION_ICON_BOX}">
        <Brain size={{16}} />
      </span>''')
# The read-only target of a heartbeat: the field's geometry on surface2 behind the border colour.
p.rep('''  const fieldStyle = useMemo(
    () => [styles.readonlyField, size === "sm" ? styles.readonlyFieldSm : styles.readonlyFieldMd],
    [size],
  );
  const textStyle = useMemo(
    () => [styles.readonlyText, size === "sm" ? styles.readonlyTextSm : styles.readonlyTextMd],
    [size],
  );

  return (
    <Field label="Target">
      <View style={fieldStyle} testID="schedule-agent-target">
        <Text style={textStyle} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Field>
  );''', '''  return (
    <Field label="Target">
      <div
        className={cn(
          formInputClassName(size),
          "flex flex-row items-center border-border bg-muted hover:border-border dark:bg-muted",
        )}
        data-testid="schedule-agent-target"
      >
        <span className="min-w-0 flex-1 truncate text-sm leading-[normal] text-foreground">
          {label}
        </span>
      </div>
    </Field>
  );''')
p.rep('''  const Icon = getProviderIcon(provider, serverId);
  return <Icon size={16} color={styles.providerIcon.color} />;
}''', '''  const Icon = getProviderIcon(provider, serverId);
  return (
    <span className="flex text-muted-foreground">
      <Icon size={16} color="currentColor" />
    </span>
  );
}''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the create / edit schedule sheet; DOM view.", "schedules.py")
