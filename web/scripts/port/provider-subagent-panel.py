#!/usr/bin/env python3
"""Port packages/app's panels/provider-subagent-panel.tsx to web/src/overrides."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/panels/provider-subagent-panel.tsx")
DST = str(ROOT / "web/src/overrides/panels/provider-subagent-panel.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:200]}\n--- found {n}")
    s = s.replace(old, new)


rep('import { Text, View } from "react-native";\nimport { StyleSheet } from "react-native-unistyles";\n', "")
rep('''      <View style={styles.unsupported} testID="provider-subagent-panel-unsupported">
        <Text style={styles.unsupportedText}>{t("message.actions.forkUnavailable")}</Text>
      </View>''', '''      <div
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="provider-subagent-panel-unsupported"
      >
        <span className="text-center text-sm text-muted-foreground">{t("message.actions.forkUnavailable")}</span>
      </div>''')
rep('''    <View style={styles.container} testID="provider-subagent-panel">
      {subtitle ? (
        <View style={styles.subtitleHeader}>
          <Text
            style={styles.subtitleText}
            numberOfLines={1}
            testID="provider-subagent-pane-subtitle"
          >
            {subtitle}
          </Text>
        </View>
      ) : null}''', '''    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="provider-subagent-panel">
      {subtitle ? (
        <div className="border-b px-3 py-1">
          <span className="block truncate text-xs text-muted-foreground" data-testid="provider-subagent-pane-subtitle">
            {subtitle}
          </span>
        </div>
      ) : null}''')
rep('''        onOpenProviderSubagent={openProviderChild}
      />
    </View>
  );
}''', '''        onOpenProviderSubagent={openProviderChild}
      />
    </div>
  );
}''')
start = s.index("const styles = StyleSheet.create((theme) => ({")
end = s.index("export const providerSubagentPanelRegistration")
s = s[:start] + s[end:]
for needle in ["<View", "<Text", "styles.", "StyleSheet"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-120:i+120]}")
s = "// Override of packages/app/src/panels/provider-subagent-panel.tsx: same logic, DOM view.\n// Generated from the Expo file by web/scripts/port/provider-subagent-panel.py.\n// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
