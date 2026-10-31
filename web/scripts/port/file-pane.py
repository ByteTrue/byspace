#!/usr/bin/env python3
"""Port packages/app's file panel and file pane to web/src/overrides: same logic, DOM view."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"


def make_rep(state):
    def rep(old, new, count=1):
        n = state["s"].count(old)
        if n != count:
            raise SystemExit(f"{state['name']}: expected {count} of:\n{old[:300]}\n--- found {n}")
        state["s"] = state["s"].replace(old, new)

    return rep


def check_leftovers(state, needles):
    for needle in needles:
        if needle in state["s"]:
            i = state["s"].index(needle)
            raise SystemExit(f"{state['name']}: leftover {needle}: {state['s'][i - 300:i + 200]}")


HEADER = """// Generated from the Expo file by web/scripts/port/file-pane.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
"""

# ---------------------------------------------------------------- panels/file-panel.tsx
panel = {"name": "file-panel", "s": (APP / "panels/file-panel.tsx").read_text(encoding="utf-8")}
rep = make_rep(panel)
rep('import { Text, View } from "react-native";\n', "")
rep('''const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

''', "")
rep('''      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>''', '''      <div className="flex flex-1 items-center justify-center p-4">
        <span>{t("panels.file.directoryMissing")}</span>
      </div>''')
check_leftovers(panel, ["<View", "<Text", "react-native"])
(OVR / "panels/file-panel.tsx").write_text(
    "// Override of packages/app/src/panels/file-panel.tsx: same descriptor and pane, DOM view.\n"
    + HEADER + panel["s"], encoding="utf-8")

# ---------------------------------------------------------------- file-pane/pane.tsx
pane = {"name": "file-pane", "s": (APP / "file-pane/pane.tsx").read_text(encoding="utf-8")}
rep = make_rep(pane)
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', "")
rep('''import { ScrollView as RNScrollView, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime, withUnistyles } from "react-native-unistyles";''',
    '''import { useUnistyles } from "react-native-unistyles";''')
# Relative imports would bypass the web overrides; go through `@/`.
for rel in ["./live-file/hook", "./preview-lifecycle/hook", "./preview-lifecycle/model", "./bar",
            "./html-preview", "./markdown-preview", "./editor/model", "./editor/observation-source",
            "./editor/view", "./source/view", "./conflict-alert", "./live-file/model"]:
    rep(f'from "{rel}";', f'from "@/file-pane/{rel[2:]}";')
if 'from "./' in pane["s"]:
    raise SystemExit("file-pane: relative import left")
# These have a .web file that Vite picks; name it so the typecheck reads the same file.
for module in ["html-preview", "editor/view", "source/view"]:
    rep(f'from "@/file-pane/{module}";', f'from "@/file-pane/{module}.web";')
rep('''import type { Theme } from "@/styles/theme";
''', "")
rep('''const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
''', '''import { Spinner } from "~/components/ui/spinner";

const CENTER_STATE = "flex flex-1 flex-col items-center justify-center gap-3 p-4";
const EMPTY_TEXT = "text-center text-sm text-muted-foreground";
const META_TEXT = "mt-2 text-sm text-muted-foreground";
const ERROR_TEXT = "text-center text-sm text-destructive";

function LoadingState({ label, testID }: { label: string; testID?: string }) {
  return (
    <div className={CENTER_STATE} data-testid={testID}>
      <Spinner className="size-4 text-muted-foreground" />
      <span className="mt-2 text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
''')
# the theme is read reactively instead of from UnistylesRuntime
rep('''  const theme = UnistylesRuntime.getTheme();
  const { t } = useTranslation();
  const visualTheme = useMemo(''', '''  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const visualTheme = useMemo(''')
rep('''  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const theme = UnistylesRuntime.getTheme();''', '''  usePublishPanelInstanceAttributes({ modified: snapshot.modified, suspendPendingSave });
  const { theme } = useUnistyles();''')

rep('''    <View style={styles.centerState} testID="file-source-too-large">
      <Text style={styles.emptyText}>{t("panels.file.tooLargeToDisplay")}</Text>
      {size ? <Text style={styles.binaryMetaText}>{formatFileSize({ size })}</Text> : null}
    </View>''', '''    <div className={CENTER_STATE} data-testid="file-source-too-large">
      <span className={EMPTY_TEXT}>{t("panels.file.tooLargeToDisplay")}</span>
      {size ? <span className={META_TEXT}>{formatFileSize({ size })}</span> : null}
    </div>''')
rep('''  const previewScrollRef = useRef<RNScrollView>(null);

''', "")
rep("  useRef,\n", "", count=1)
rep('''      <View style={styles.centerState} testID="file-preview-loading">
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
      </View>''', '''      <LoadingState label={t("panels.file.loading")} testID="file-preview-loading" />''')
rep('''      <View style={styles.centerState} testID="file-preview-unsupported">
        <Text style={styles.emptyText}>{t("panels.file.noPreview")}</Text>
      </View>''', '''      <div className={CENTER_STATE} data-testid="file-preview-unsupported">
        <span className={EMPTY_TEXT}>{t("panels.file.noPreview")}</span>
      </div>''')
rep('''        <View style={styles.previewScrollContainer}>
          <FileHtmlPreview html={preview.content ?? ""} testID="file-html-preview" />
        </View>''', '''        <div className="flex min-h-0 flex-1 flex-col">
          <FileHtmlPreview html={preview.content ?? ""} testID="file-html-preview" />
        </div>''')
rep('''        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            showsVerticalScrollIndicator
          >
            <FileMarkdownPreview source={preview.content ?? ""} />
          </RNScrollView>
        </View>''', '''        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="file-markdown-preview">
            <FileMarkdownPreview source={preview.content ?? ""} />
          </div>
        </div>''')
rep('''        <View style={styles.centerState}>
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          <Text style={styles.loadingText}>{t("panels.file.loading")}</Text>
        </View>''', '''        <LoadingState label={t("panels.file.loading")} />''')
rep('''    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
    </View>''', '''    <div className={CENTER_STATE}>
      <span className={EMPTY_TEXT}>{t("panels.file.binaryPreviewUnavailable")}</span>
      <span className={META_TEXT}>{formatFileSize({ size: preview.size })}</span>
    </div>''')
# containers
PANE_OPEN = '<div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="workspace-file-pane">'
rep('''      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{disconnectedMessage}</Text>
        </View>
      </View>''', f'''      {PANE_OPEN}
        <div className={{CENTER_STATE}}>
          <span className={{ERROR_TEXT}}>{{disconnectedMessage}}</span>
        </div>
      </div>''')
rep('''        <View style={styles.container} testID="workspace-file-pane">
          <TooLargeSource />
        </View>''', f'''        {PANE_OPEN}
          <TooLargeSource />
        </div>''')
rep('''      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>''', f'''      {PANE_OPEN}
        <div className={{CENTER_STATE}}>
          <span className={{ERROR_TEXT}}>{{errorMessage}}</span>''')
rep('''            {retryLabel}
          </Button>
        </View>
      </View>''', '''            {retryLabel}
          </Button>
        </div>
      </div>''')
rep('''    <View style={styles.container} testID="workspace-file-pane">
      {preview ? (''', f'''    {PANE_OPEN}
      {{preview ? (''')
rep('''        imagePreviewUri={imagePreviewUri}
      />
    </View>
  );
}''', '''        imagePreviewUri={imagePreviewUri}
      />
    </div>
  );
}''')
rep('''    <View style={styles.container} testID="workspace-file-pane">
      <FilePanelBar''', f'''    {PANE_OPEN}
      <FilePanelBar''')
rep('''          imagePreviewUri={null}
        />
      )}
    </View>''', '''          imagePreviewUri={null}
        />
      )}
    </div>''')
start = pane["s"].index("const styles = StyleSheet.create((theme) => ({")
pane["s"] = pane["s"][:start].rstrip() + "\n"
pane["s"] = pane["s"].replace("import React, {", "import {", 1)
check_leftovers(pane, ["<View", "<Text", "RNScrollView", "styles.", "StyleSheet", "UnistylesRuntime",
                       "ThemedLoadingSpinner", "withUnistyles"])
(OVR / "file-pane/pane.tsx").write_text(
    "// Override of packages/app/src/file-pane/pane.tsx. The read, live-update, edit, save and\n"
    "// conflict logic is the Expo file's; the view is DOM and Tailwind.\n" + HEADER + pane["s"],
    encoding="utf-8")
print("ok")
