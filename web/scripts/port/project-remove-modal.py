"""Port packages/app's projects/project-remove-modal.tsx to web/src/overrides: removing a project
that lives on several hosts, from one host or from all, on the same AdaptiveModalSheet as
packages/app. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("projects/project-remove-modal.tsx")
p.rep('''import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', "")
p.rep('''    <View style={styles.hostRow}>
      <View style={styles.hostInfo}>
        <HostStatusDot serverId={host.serverId} />
        <Text style={styles.hostName} numberOfLines={1}>
          {hostName}
        </Text>
      </View>''', '''    <div className="flex flex-row items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
      <div className="flex flex-1 flex-row items-center gap-2">
        <HostStatusDot serverId={host.serverId} />
        <span className="shrink truncate text-sm leading-[normal] font-medium text-foreground">
          {hostName}
        </span>
      </div>''')
p.rep('''        {t("sidebar.project.confirmations.removeFromHost", { hostName })}
      </Button>
    </View>
  );''', '''        {t("sidebar.project.confirmations.removeFromHost", { hostName })}
      </Button>
    </div>
  );''')
p.rep('''      <View style={styles.body}>
        <Text style={styles.promptText}>
          {t("sidebar.project.confirmations.removeMultiHostPrompt", { projectName })}
        </Text>
        <Text style={styles.noteText}>{t("sidebar.project.confirmations.removeNote")}</Text>

        <View style={styles.hostList}>''', '''      <div className="flex flex-col gap-3 pb-2">
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("sidebar.project.confirmations.removeMultiHostPrompt", { projectName })}
        </span>
        <span className="text-xs leading-[normal] text-muted-foreground">
          {t("sidebar.project.confirmations.removeNote")}
        </span>

        <div className="my-1 flex flex-col gap-2">''')
p.rep('''          })}
        </View>

        <View style={styles.actions}>''', '''          })}
        </div>

        <div className="mt-2 flex flex-col gap-2">''')
p.rep('''            style={styles.allHostsButton}''', '''            className="w-full"''')
p.rep('''            style={styles.cancelButton}''', '''            className="w-full"''')
p.rep('''          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>''', '''          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("removing a multi-host project from one host or all, on AdaptiveModalSheet; DOM view.",
        "project-remove-modal.py")
