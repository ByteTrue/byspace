"""Port packages/app's components/provider-catalog-list.tsx to web/src/overrides: the searchable
ACP provider catalog. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

MUTED_XS = "text-xs leading-[normal] text-muted-foreground"

p = Port("components/provider-catalog-list.tsx")
p.rep('import { Pressable, Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('import { isWeb } from "@/constants/platform";\n', "")
p.rep('''const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
''', "")
p.rep('''    <View style={styles.row}>
      <View style={styles.iconFrame}>''', '''    <div className="flex flex-row items-center gap-3 border-b p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">''')
p.rep('''        )}
      </View>
      <View style={styles.textColumn}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.version} numberOfLines={1}>
            {entry.version}
          </Text>
        </View>
        <Text style={styles.description} numberOfLines={1}>
          {entry.description || entry.id}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("providerCatalog.actions.installInstructionsFor", {
            provider: entry.title,
          })}
          onPress={handleOpenInstallLink}
          style={styles.installLink}
        >
          <Text style={styles.installLinkText} numberOfLines={1}>
            {t("providerCatalog.actions.installInstructions")}
          </Text>
          <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      </View>''', f'''        )}}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <span className="shrink truncate text-sm leading-[normal] font-medium text-foreground">
            {{entry.title}}
          </span>
          <span className="shrink-0 truncate {MUTED_XS}">{{entry.version}}</span>
        </div>
        <span className="truncate {MUTED_XS}">{{entry.description || entry.id}}</span>
        <button
          type="button"
          role="link"
          aria-label={{t("providerCatalog.actions.installInstructionsFor", {{
            provider: entry.title,
          }})}}
          onClick={{handleOpenInstallLink}}
          className="flex max-w-full flex-row items-center gap-1 self-start text-left"
        >
          <span className="truncate {MUTED_XS}">
            {{t("providerCatalog.actions.installInstructions")}}
          </span>
          <ThemedExternalLink size={{12}} uniProps={{foregroundMutedColorMapping}} />
        </button>
      </div>''')
p.rep('''        onPress={handleInstall}
        style={styles.actionButton}''', '''        onPress={handleInstall}
        className="w-[92px] shrink-0"''')
p.rep('''        {actionLabel}
      </Button>
    </View>''', '''        {actionLabel}
      </Button>
    </div>''')
p.rep('''    <View>
      <View style={styles.searchField}>
        <View style={styles.searchIcon}>
          <ThemedSearch size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
        </View>
        <ThemedTextInput''', '''    <div>
      <div className="mb-3 flex flex-row items-center gap-2 rounded-lg border bg-muted px-3">
        <div className="flex w-[18px] items-center justify-center">
          <ThemedSearch size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
        </div>
        <TextInput''')
p.rep('''          // @ts-expect-error - outlineStyle is web-only
          style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}''',
      '''          className="min-w-0 flex-1 bg-transparent py-3 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"''')
p.rep('''      </View>

      {availableEntries.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{t("providerCatalog.noProviders")}</Text>
        </View>
      ) : (
        <View style={styles.list}>''', '''      </div>

      {availableEntries.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-4">
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("providerCatalog.noProviders")}
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">''')
p.rep('''          ))}
        </View>
      )}
    </View>''', '''          ))}
        </div>
      )}
    </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the searchable ACP provider catalog; DOM view.", "provider-catalog-list.py")
