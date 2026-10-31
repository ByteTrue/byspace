#!/usr/bin/env python3
"""Port packages/app's agent-profiles/settings/agent-profile-edit-modal.tsx to web/src/overrides."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/agent-profiles/settings/agent-profile-edit-modal.tsx")
DST = str(ROOT / "web/src/overrides/agent-profiles/settings/agent-profile-edit-modal.tsx")
s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:300]}\n--- found {n}")
    s = s.replace(old, new)


rep('import { Text, View } from "react-native";\n', "")
rep('import { StyleSheet } from "react-native-unistyles";\n', 'import { cn } from "cn";\n')
# Relative imports would bypass the web overrides; go through `@/`.
s = s.replace('from "./agent-profile-appearance-field"', 'from "@/agent-profiles/settings/agent-profile-appearance-field"')
s = s.replace('from "../internal/', 'from "@/agent-profiles/internal/')

CLASSES = {
    "body": "flex flex-col gap-4 pb-2",
    "nameRow": "flex items-start gap-2",
    "iconField": "shrink-0",
    "nameField": "min-w-0 flex-1",
    "featureCard": "rounded-md border bg-muted px-3",
    "featureMeta": "flex min-w-0 flex-1 flex-col gap-1",
    "actions": "mt-2 flex items-center gap-2",
}


def view_sub(match):
    key = match.group(1)
    if key not in CLASSES:
        raise SystemExit(f"no class for styles.{key}")
    return f'<div className="{CLASSES[key]}"'


s = re.sub(r"<View style=\{styles\.(\w+)\}", view_sub, s)
rep('''            multiline
            numberOfLines={4}
            style={styles.notesInput}''', '''            multiline
            rows={4}
            className="min-h-[88px]"''')
rep('''          <Text style={styles.submitError} testID="agent-profile-submit-error">
            {state.submitError}
          </Text>''', '''          <span className="text-sm text-status-danger" data-testid="agent-profile-submit-error">
            {state.submitError}
          </span>''')
rep('            style={styles.actionButton}\n', '            className="flex-1"\n', count=2)
rep('''  const rowStyle = useMemo(
    () => [styles.featureRow, isFirst ? null : styles.featureRowBorder],
    [isFirst],
  );''', '''  const rowClassName = cn("flex items-center justify-between gap-3 py-3", !isFirst && "border-t");''')
rep("<View style={rowStyle}", '<div className={rowClassName}', count=2)
rep('''        <Text style={styles.featureLabel} numberOfLines={1}>
          {feature.label}
        </Text>
        {feature.description ? (
          <Text style={styles.featureDescription} numberOfLines={2}>
            {feature.description}
          </Text>
        ) : null}''', '''        <span className="truncate text-sm text-foreground">{feature.label}</span>
        {feature.description ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">{feature.description}</span>
        ) : null}''')
s = s.replace("</View>", "</div>")
s = re.sub(r'(<div[^>]*?)\btestID=', r"\1data-testid=", s)
s = s.replace("autoCorrect={false}", 'autoCorrect="off"')
start = s.index("const styles = StyleSheet.create(")
s = s[:start].rstrip() + "\n"
for needle in ["<View", "<Text", "styles.", "StyleSheet"]:
    if needle in s:
        i = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[i-200:i+200]}")
s = """// Override of packages/app/src/agent-profiles/settings/agent-profile-edit-modal.tsx: same form
// model and open/close lifecycle, DOM view.
// Generated from the Expo file by web/scripts/port/agent-profile-edit-modal.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
""" + s
open(DST, "w", encoding="utf-8").write(s)
print("ok", len(s.splitlines()))
