"""Port packages/app's screens/projects-screen.tsx to web/src/overrides: a host's projects in
settings, one row per project that opens its settings. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("screens/projects-screen.tsx")
p.rep('''import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
''', '''import { useCallback, useMemo, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
''')
# A memoized list, so the banner's prop is not a new array on every render (react-perf lint).
p.rep('''  const scopedErrors = hostErrors.filter((error) => error.serverId === serverId);''',
      '''  const scopedErrors = useMemo(
    () => hostErrors.filter((error) => error.serverId === serverId),
    [hostErrors, serverId],
  );''')
p.rep('''      <View style={styles.centered} testID="projects-list">
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>''', '''      <div
        className="flex flex-1 flex-col items-center justify-center p-6 text-muted-foreground"
        data-testid="projects-list"
      >
        <LoadingSpinner size="large" />
      </div>''')
p.rep('''      <View style={styles.centered} testID="projects-list">
        <Text style={styles.emptyText}>{t("sidebar.project.empty.title")}</Text>
      </View>''', '''      <div
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="projects-list"
      >
        <span className="text-sm leading-[normal] text-muted-foreground">
          {t("sidebar.project.empty.title")}
        </span>
      </div>''')
p.rep('''    <View testID="projects-list">
      {scopedErrors.length > 0 ? <HostErrorsBanner errors={scopedErrors} /> : null}
      <View style={settingsStyles.card}>''', '''    <div className="flex flex-col" data-testid="projects-list">
      {scopedErrors.length > 0 ? <HostErrorsBanner errors={scopedErrors} /> : null}
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
p.rep('''    <View style={styles.errorsBanner} testID="projects-host-errors">
      {errors.map((error) => (
        <Text key={error.serverId} style={styles.errorsBannerText}>''', '''    <div className="mb-3 flex flex-col gap-1 rounded-lg border p-3" data-testid="projects-host-errors">
      {errors.map((error) => (
        <span key={error.serverId} className="text-xs leading-[normal] text-red-300">''')
p.rep('''          })}
        </Text>
      ))}
    </View>
  );
}''', '''          })}
        </span>
      ))}
    </div>
  );
}''')
p.rep('''  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { viewKey } = project;''', '''  const { t } = useTranslation();
  const { viewKey } = project;''')
p.rep('''  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handleNavigate}
      accessibilityRole="button"
      accessibilityLabel={t("settings.projectList.editProject", { projectName })}
      testID={`project-row-${viewKey}`}
    >
      <View style={styles.rowMain}>
        <View style={styles.leading}>
          <ProjectRowIcon
            iconDataUri={iconDataUri}
            projectName={projectName}
            projectViewKey={viewKey}
          />
        </View>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {projectName}
        </Text>
      </View>
      <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
    </Pressable>
  );''', '''  return (
    <button
      type="button"
      className={cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "gap-3 text-left hover:bg-muted active:bg-(--surface-3)",
      )}
      onClick={handleNavigate}
      aria-label={t("settings.projectList.editProject", { projectName })}
      data-testid={`project-row-${viewKey}`}
    >
      <div className="flex min-w-0 flex-1 flex-row items-center gap-3">
        <div className="flex size-4 shrink-0 items-center justify-center">
          <ProjectRowIcon
            iconDataUri={iconDataUri}
            projectName={projectName}
            projectViewKey={viewKey}
          />
        </div>
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{projectName}</span>
      </div>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );''')
p.rep('''      size={16}
      textStyle={styles.iconFallbackText}
    />''', '''      size={16}
      textStyle={ICON_FALLBACK_TEXT}
    />''')
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const ICON_FALLBACK_TEXT: CSSProperties = { fontSize: 12 };
'''
p.check()
p.write("a host's project list in settings; DOM view.", "projects-screen.py")
