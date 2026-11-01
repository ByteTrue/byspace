"""Port packages/app's provider-usage/settings-section.tsx and provider-usage/list.tsx to
web/src/overrides: the Usage page of a host's settings. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("provider-usage/settings-section.tsx")
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('import { Text, View } from "react-native";\n', 'import { cn } from "cn";\n')
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
# an override's relative imports do not reach packages/app
p.rep('from "./copy";', 'from "@/provider-usage/copy";')
p.rep('from "./list";', 'from "@/provider-usage/list";')
p.rep('from "./types";', 'from "@/provider-usage/types";')
for key in ("loading", "empty"):
    p.rep(f'''      <View style={{[settingsStyles.card, styles.emptyCard]}}>
        <Text style={{styles.emptyText}}>{{providerUsageCopy.{key}}}</Text>
      </View>''', f'''      <div className={{cn(settingsStyles.card, "items-center p-4")}}>
        <span className="text-sm leading-[normal] text-muted-foreground">
          {{providerUsageCopy.{key}}}
        </span>
      </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the Usage page section; DOM view.", "provider-usage-settings.py")

p = Port("provider-usage/list.tsx")
p.rep('import { View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('from "./card";', 'from "@/provider-usage/card";')
p.rep('from "./types";', 'from "@/provider-usage/types";')
p.rep('''    <View style={settingsStyles.card}>''', '''    <div className={settingsStyles.card}>''')
p.rep('''          {index > 0 ? <View style={styles.divider} /> : null}''',
      '''          {index > 0 ? <div className="h-px bg-border" /> : null}''')
p.rep('''      ))}
    </View>''', '''      ))}
    </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the per-provider usage cards in one settings card; DOM view.", "provider-usage-settings.py")
