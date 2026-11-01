"""Port packages/app's components/provider-diagnostic-sheet.tsx and
components/provider-terminal-integration.tsx to web/src/overrides: a provider's settings sheet
(models, add custom model, diagnostic, terminal tab). Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

MUTED = "text-sm leading-[normal] text-muted-foreground"
ICON_BUTTON = (
    "flex size-7 shrink-0 items-center justify-center rounded-full outline-none hover:bg-muted "
    "active:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 "
    "disabled:hover:bg-transparent"
)
MODEL_ROW = "flex flex-row items-center gap-3 border-t px-4 py-2"
MODEL_TITLE = "shrink-0 truncate text-sm leading-[normal] text-foreground"
# packages/app tags the id with CODE_SURFACE_DATASET, so it keeps the mono font.
MONO_HINT = "shrink-0 truncate font-mono text-xs leading-[normal] text-muted-foreground select-text"
SECTION_HEADER_TITLE = "settingsStyles.sectionHeaderTitle"

p = Port("components/provider-diagnostic-sheet.tsx")
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, useUnistyles } from "react-native-unistyles";\n',
      'import { useUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";\n')
p.rep('import { isWeb } from "@/constants/platform";\n', "")
p.rep('import { CODE_SURFACE_DATASET } from "@/styles/code-surface";\n', "")
# an override's relative imports do not reach packages/app
p.rep('from "./provider-terminal-integration";', 'from "@/components/provider-terminal-integration";')
p.rep('''} from "./provider-diagnostic-models";''', '''} from "@/components/provider-diagnostic-models";''')
p.rep('''function rankModels<T>(''', f'''const ICON_BUTTON =
  "{ICON_BUTTON}";
const MODEL_ROW = "{MODEL_ROW}";
const MODEL_TITLE = "{MODEL_TITLE}";
const MONO_HINT =
  "{MONO_HINT}";

function rankModels<T>(''')

# ---- model rows ----
p.rep('''    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text
        style={sheetStyles.monoHint}
        numberOfLines={1}
        selectable
        dataSet={CODE_SURFACE_DATASET}
      >
        {model.id}
      </Text>
      {model.description ? (
        <Text style={sheetStyles.descriptionInline} numberOfLines={1}>
          {model.description}
        </Text>
      ) : null}
    </View>''', '''    <div className={MODEL_ROW}>
      <span className={MODEL_TITLE}>{model.label}</span>
      <span className={MONO_HINT} data-pmono="">
        {model.id}
      </span>
      {model.description ? (
        <span className="min-w-0 flex-1 truncate text-xs leading-[normal] text-muted-foreground">
          {model.description}
        </span>
      ) : null}
    </div>''')
p.rep('''  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      deleting ? sheetStyles.disabled : null,
    ],
    [deleting],
  );
''', "")
p.rep('''    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text
        style={sheetStyles.monoHint}
        numberOfLines={1}
        selectable
        dataSet={CODE_SURFACE_DATASET}
      >
        {model.id}
      </Text>
      <View style={sheetStyles.modelRowFiller} />
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />
      </Pressable>
    </View>''', '''    <div className={MODEL_ROW}>
      <span className={MODEL_TITLE}>{model.label}</span>
      <span className={MONO_HINT} data-pmono="">
        {model.id}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className={ICON_BUTTON}
        aria-label={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />
      </button>
    </div>''')

# ---- section header ----
p.rep('''    <View style={sheetStyles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={sheetStyles.sectionHeaderMeta}>
        {count !== undefined ? (
          <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
        ) : null}
        {count !== undefined && hint ? (
          <Text style={settingsStyles.sectionHeaderTitle}>·</Text>
        ) : null}
        {hint ? <Text style={settingsStyles.sectionHeaderTitle}>{hint}</Text> : null}
      </View>
    </View>''', '''    <div className="mb-2 ml-1 flex flex-row items-center justify-between gap-2">
      <span className={settingsStyles.sectionHeaderTitle}>{title}</span>
      <div className="flex flex-row items-center gap-1">
        {count !== undefined ? (
          <span className={settingsStyles.sectionHeaderTitle}>{count}</span>
        ) : null}
        {count !== undefined && hint ? (
          <span className={settingsStyles.sectionHeaderTitle}>·</span>
        ) : null}
        {hint ? <span className={settingsStyles.sectionHeaderTitle}>{hint}</span> : null}
      </div>
    </div>''')

# ---- add custom model ----
p.rep('''      <View style={sheetStyles.formGroup}>
        <Text style={sheetStyles.formLabel}>{t("settings.providers.models.modelId")}</Text>''',
      '''      <div className="flex flex-col gap-3">
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("settings.providers.models.modelId")}
        </span>''')
p.rep('''          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          // @ts-expect-error - outlineStyle is web-only
          style={[sheetStyles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        <View style={sheetStyles.formActions}>''', '''          autoCapitalize="none"
          autoCorrect={false}
          enterKeyHint="done"
          className="rounded-lg border bg-muted px-4 py-3 text-sm leading-[normal] outline-none"
        />
        {error ? (
          <span className="text-xs leading-[normal] text-destructive">{error}</span>
        ) : null}
        <div className="flex flex-row justify-end gap-2">''')
p.rep('''          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet(''', '''          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet(''')
p.rep('''  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [input, setInput] = useState("");''', '''  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [input, setInput] = useState("");''')

# ---- diagnostic sub-sheet ----
p.rep('''  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );
''', "")
p.rep('''  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && sheetStyles.iconButtonHovered,
      diagnostic ? null : sheetStyles.disabled,
    ],
    [diagnostic],
  );
''', "")
p.rep('''        <View style={sheetStyles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={''', '''        <div className="flex flex-row items-center gap-1">
          <button
            type="button"
            onClick={handleCopyPress}
            disabled={!diagnostic}
            className={ICON_BUTTON}
            aria-label={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </button>
          <button
            type="button"
            onClick={handleRefreshPress}
            disabled={loading}
            className={ICON_BUTTON}
            aria-label={''')
p.rep('''              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,''', '''              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </button>
        </div>
      ),
    }),
    [
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      t,''')
p.rep('''        <View style={sheetStyles.codeBlockLoading}>
          <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>''', f'''        <div className="flex flex-row items-center gap-2 p-4">
          <LoadingSpinner size="small" color={{theme.colors.foregroundMuted}} />
          <span className="{MUTED}">{{t("settings.providers.diagnostic.running")}}</span>
        </div>''')
p.rep('''        <View style={sheetStyles.codeBlockLoading}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>''', f'''        <div className="flex flex-row items-center gap-2 p-4">
          <span className="{MUTED}">{{t("settings.providers.diagnostic.none")}}</span>
        </div>''')

# ---- footer ----
p.rep('''  const contentStyle = isCompact ? sheetStyles.compactFooterContent : sheetStyles.footerContent;
  const actionsStyle = isCompact ? sheetStyles.compactFooterActions : sheetStyles.footerActions;
  const buttonStyle = isCompact ? sheetStyles.compactFooterButton : null;
  const metaStyle = isCompact
    ? [sheetStyles.footerMeta, sheetStyles.compactFooterMeta]
    : sheetStyles.footerMeta;

  return (
    <View style={contentStyle}>
      {fetchedAtLabel || !isCompact ? (
        <Text style={metaStyle} numberOfLines={1}>
          {fetchedAtLabel ? t("settings.providers.models.updated", { time: fetchedAtLabel }) : ""}
        </Text>
      ) : null}
      <View style={actionsStyle}>''', '''  const buttonClassName = isCompact ? "self-stretch" : undefined;

  return (
    <div
      className={cn(
        "flex flex-1 gap-2",
        isCompact ? "flex-col" : "flex-row items-center justify-between",
      )}
    >
      {fetchedAtLabel || !isCompact ? (
        <span
          className={cn(
            "truncate text-xs leading-[normal] text-muted-foreground",
            !isCompact && "flex-1",
          )}
        >
          {fetchedAtLabel ? t("settings.providers.models.updated", { time: fetchedAtLabel }) : ""}
        </span>
      ) : null}
      <div className={cn("flex gap-2", isCompact ? "flex-col" : "flex-row items-center")}>''')
p.rep('''          style={buttonStyle}''', '''          className={buttonClassName}''', 3)
p.rep('''            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </View>
    </View>''', '''            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </div>
    </div>''')

# ---- body states ----
EMPTY = "flex flex-col items-center gap-3 py-8"
p.rep('''      <View style={sheetStyles.emptyState}>
        <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.loading")}</Text>
      </View>''', f'''      <div className="{EMPTY}">
        <LoadingSpinner size="small" color={{theme.colors.foregroundMuted}} />
        <span className="{MUTED}">{{t("settings.providers.models.loading")}}</span>
      </div>''')
p.rep('''      <View style={sheetStyles.emptyState}>
        <AlertTriangle size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
        <Text style={sheetStyles.mutedText}>{providerErrorMessage}</Text>''', f'''      <div className="{EMPTY}">
        <AlertTriangle size={{theme.iconSize.md}} color={{theme.colors.foregroundMuted}} />
        <span className="{MUTED} text-center">{{providerErrorMessage}}</span>''')
p.rep('''            : t("settings.providers.models.retry")}
        </Button>
      </View>''', '''            : t("settings.providers.models.retry")}
        </Button>
      </div>''')
p.rep('''      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noSearchMatches")}</Text>
      </View>''', f'''      <div className="{EMPTY}">
        <span className="{MUTED}">{{t("settings.providers.models.noSearchMatches")}}</span>
      </div>''')
p.rep('''      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("settings.providers.models.noneDetected")}</Text>
      </View>''', f'''      <div className="{EMPTY}">
        <span className="{MUTED}">{{t("settings.providers.models.noneDetected")}}</span>
      </div>''')
p.rep('''        <View style={sheetStyles.section}>''', '''        <div className="mb-4 flex flex-col">''', 2)
# Every model row draws its top border, the first one too (as packages/app does).
p.rep('''          <View style={settingsStyles.card}>''', '''          <div className={settingsStyles.card}>''', 2)
p.rep('''            ))}
          </View>
        </View>
      ) : null}''', '''            ))}
          </div>
        </div>
      ) : null}''', 2)
# hoisted: the web lint rejects an array built inline as a prop
p.rep('''        <SegmentedControl
          options={[
            { value: "agent", label: t("settings.providers.tabs.agent") },
            { value: "terminal", label: t("settings.providers.tabs.terminal") },
          ]}''', '''        <SegmentedControl
          options={tabOptions}''')
p.rep('''  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: providerLabel,''', '''  const tabOptions = useMemo(
    () => [
      { value: "agent" as const, label: t("settings.providers.tabs.agent") },
      { value: "terminal" as const, label: t("settings.providers.tabs.terminal") },
    ],
    [t],
  );
  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: providerLabel,''')
p.rep('''    [providerLabel, isTerminalProvider, tab, t],''', '''    [providerLabel, isTerminalProvider, tab, tabOptions, t],''')
p.cut_from("const sheetStyles = StyleSheet.create")
# the snap points sat after the styles; keep them
p.s += '''
// Open and expanded detents for the compact bottom sheet. The desktop card
// pins to the first one so both faces of the sheet keep one height (see the
// `desktopHeight` note on the sheet below).
const MAIN_SNAP_POINTS = ["65%", "92%"];
const DESKTOP_SHEET_HEIGHT = "65%";
const ADD_SNAP_POINTS = ["40%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];
'''
p.check()
p.write("a provider's settings sheet: models, custom models, diagnostic, terminal tab; DOM view.",
        "provider-diagnostic-sheet.py")

# ---- provider-terminal-integration.tsx ----
p = Port("components/provider-terminal-integration.tsx")
p.rep('import { Alert, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\n')
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('from "./provider-terminal-profile-save";', 'from "@/components/provider-terminal-profile-save";')
SECTION_HEADER = '<div className="ml-1 flex flex-col gap-1">'
HINT = "text-xs leading-[normal] text-muted-foreground"
p.rep('''    <View style={styles.container} testID="provider-terminal-integration">''',
      '''    <div className="flex flex-col gap-4" data-testid="provider-terminal-integration">''')
p.rep('''        <View style={styles.section}>
          <View style={styles.sectionHeader}>''', f'''        <div className="flex flex-col gap-2">
          {SECTION_HEADER}''')
p.rep('''            <Text style={styles.sectionHint}>
              {t("settings.host.terminalAgentHooks.sectionHint")}
            </Text>
          </View>''', f'''            <span className="{HINT}">
              {{t("settings.host.terminalAgentHooks.sectionHint")}}
            </span>
          </div>''')
p.rep('''      <View style={styles.section}>
        <View style={styles.sectionHeader}>''', f'''      <div className="flex flex-col gap-2">
        {SECTION_HEADER}''')
p.rep('''          <Text style={styles.sectionHint}>{t("settings.host.terminalProfiles.providerHint")}</Text>
        </View>''', f'''          <span className="{HINT}">{{t("settings.host.terminalProfiles.providerHint")}}</span>
        </div>''')
# no CODE_SURFACE_DATASET here, so packages/app's root font rule shows it in the UI font
p.rep('''              <Text style={styles.commandText} numberOfLines={2}>''',
      f'''              <span className="line-clamp-2 {HINT}">''')
p.rep('''                {commandText ?? t("settings.host.terminalProfiles.providerMissingHint")}
              </Text>''', '''                {commandText ?? t("settings.host.terminalProfiles.providerMissingHint")}
              </span>''')
p.dom_tags()
p.dom_attrs()
p.cut_from("const styles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("the Terminal tab of a provider's settings sheet; DOM view.", "provider-diagnostic-sheet.py")
