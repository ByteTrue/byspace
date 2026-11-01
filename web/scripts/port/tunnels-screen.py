"""Port packages/app's screens/tunnels-screen.tsx to web/src/overrides: daemon tunnels (the enable
card, port forwards with start / pause all, the allowlist, the add and edit sheets). Same logic,
DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

HINT = "mt-2 text-xs leading-[normal] text-muted-foreground"
INLINE_ERROR = "mt-2 text-xs leading-[normal] text-red-300"
SUBTITLE = "text-xs leading-[normal] text-muted-foreground"
# endpointPill + endpointMono: a 4px-radius surface2 pill round 12px text. packages/app's mono font
# never reached this text on the web (it renders in the UI font), and neither does it here.
PILL = "rounded-[4px] bg-muted px-2 py-0.5"
MONO = "text-xs leading-[normal] text-foreground"

p = Port("screens/tunnels-screen.tsx")
p.rep('''import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
''', '''import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
''')
p.rep('''import { settingsStyles } from "@/styles/settings";
''', '''import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
''')
p.rep('''const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedArrowRight = withUnistyles(ArrowRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTrashIcon = withUnistyles(Trash2, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
''', '''function MutedSpinner(): ReactElement {
  return (
    <span className="flex text-muted-foreground">
      <LoadingSpinner size={14} />
    </span>
  );
}

// size-3.5 keeps the icon at its 14px inside an xs button (shadcn sizes unclassed icons to 12px).
const TRASH_ICON = <Trash2 size={14} className="size-3.5 text-muted-foreground" />;
''')

# Screen
p.rep('''    return <View style={styles.container} />;''', '''    return <div className={CONTAINER} />;''')
p.rep('''    <View style={styles.container}>
      <MenuHeader title={t("tunnels.title")} />
      <ScrollView contentContainerStyle={styles.content}>''', '''    <div className={CONTAINER}>
      <MenuHeader title={t("tunnels.title")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">''')
p.rep('''          onRemoved={refetch}
        />
      </ScrollView>''', '''          onRemoved={refetch}
        />
        </div>
      </div>''')
p.rep('''        <EditTunnelSheet entry={formState.entry} onClose={closeForm} onSaved={handleSaved} />
      ) : undefined}
    </View>
  );
}''', '''        <EditTunnelSheet entry={formState.entry} onClose={closeForm} onSaved={handleSaved} />
      ) : undefined}
    </div>
  );
}''')

# Body states
p.rep('''    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
  }
  if (!props.localDaemonSupportsTunnels) {
    return <Text style={styles.hint}>{t("tunnels.hostTooOld")}</Text>;
  }
  if (props.configLoading && !props.config) {
    return (
      <View style={styles.loadingRow}>
        <ThemedLoadingSpinner size={14} />
        <Text style={styles.hint}>{t("common.states.loading")}</Text>
      </View>
    );
  }''', f'''    return <span className="{HINT}">{{t("tunnels.noLocalDaemon")}}</span>;
  }}
  if (!props.localDaemonSupportsTunnels) {{
    return <span className="{HINT}">{{t("tunnels.hostTooOld")}}</span>;
  }}
  if (props.configLoading && !props.config) {{
    return (
      <div className={{LOADING_ROW}}>
        <MutedSpinner />
        <span className="{HINT}">{{t("common.states.loading")}}</span>
      </div>
    );
  }}''')
p.rep('''      <View style={styles.sectionHeaderActions}>
        <StatusBadge label={t("tunnels.experimental")} variant="muted" />''', '''      <div className="flex shrink-0 flex-row items-center gap-2">
        <StatusBadge label={t("tunnels.experimental")} variant="muted" />''')
p.rep('''        <AddTunnelButton onPress={onAddTunnel} />
      </View>
    ),''', '''        <AddTunnelButton onPress={onAddTunnel} />
      </div>
    ),''')
p.rep('''    <View style={styles.enabledBody}>
      <SettingsSection title={forwardsTitle} trailing={sectionTrailing}>''', '''    <div className="flex flex-col gap-4">
      <SettingsSection title={forwardsTitle} trailing={sectionTrailing}>''')
p.rep('''      <AllowlistSection serverId={localDaemonServerId} />
    </View>
  );
}''', '''      <AllowlistSection serverId={localDaemonServerId} />
    </div>
  );
}''')

# Enable card
p.rep('''    <View style={settingsStyles.card} testID="tunnels-enable-card">
      <View style={[settingsStyles.row, styles.enableCardRow]}>
        <View style={styles.rowContent}>
          <Text style={styles.sectionLabel}>{t("tunnels.enable.title")}</Text>
          <Text style={styles.hint}>{t("tunnels.enable.description")}</Text>
          {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
        </View>''', f'''    <div className={{settingsStyles.card}} data-testid="tunnels-enable-card">
      <div className={{cn(settingsStyles.row, "gap-3")}}>
        <div className={{ROW_CONTENT}}>
          <span className="mb-2 text-sm leading-[normal] font-medium text-foreground">
            {{t("tunnels.enable.title")}}
          </span>
          <span className="{HINT}">{{t("tunnels.enable.description")}}</span>
          {{error ? <span className="{INLINE_ERROR}">{{error}}</span> : undefined}}
        </div>''')
p.rep('''          {enabling ? t("tunnels.enable.enabling") : t("tunnels.enable.action")}
        </Button>
      </View>
    </View>
  );
}''', '''          {enabling ? t("tunnels.enable.enabling") : t("tunnels.enable.action")}
        </Button>
      </div>
    </div>
  );
}''')

# List body
p.rep('''    return <Text style={styles.hint}>{t("tunnels.noLocalDaemon")}</Text>;
  }
  if (loadState.status !== "loaded") {
    return (
      <View style={settingsStyles.card}>
        <View style={styles.loadingRow}>
          <ThemedLoadingSpinner size={14} />
          <Text style={styles.hint}>{t("common.states.loading")}</Text>
        </View>
      </View>
    );
  }''', f'''    return <span className="{HINT}">{{t("tunnels.noLocalDaemon")}}</span>;
  }}
  if (loadState.status !== "loaded") {{
    return (
      <div className={{settingsStyles.card}}>
        <div className={{LOADING_ROW}}>
          <MutedSpinner />
          <span className="{HINT}">{{t("common.states.loading")}}</span>
        </div>
      </div>
    );
  }}''')
p.rep('''      <View style={settingsStyles.card}>
        <View style={styles.emptyState}>
          <ArrowRightLeft size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
          <View style={styles.emptyTextStack}>
            <Text style={styles.emptyTitle}>{t("tunnels.empty")}</Text>
            <Text style={styles.emptyDescription}>{t("tunnels.emptyDescription")}</Text>
          </View>''', '''      <div className={settingsStyles.card}>
        <div className="flex flex-col items-center gap-4 px-4 py-6">
          <ArrowRightLeft size={ICON_SIZE.lg} className="text-muted-foreground" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm leading-[normal] text-foreground">{t("tunnels.empty")}</span>
            <span className="text-center text-xs leading-[normal] text-muted-foreground">
              {t("tunnels.emptyDescription")}
            </span>
          </div>''')
p.rep('''            {t("tunnels.add")}
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>''', '''            {t("tunnels.add")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={settingsStyles.card}>''')
p.rep('''          onRemoved={onRemoved}
        />
      ))}
    </View>
  );
}''', '''          onRemoved={onRemoved}
        />
      ))}
    </div>
  );
}''')

# Row
p.rep('''    <View
      style={[settingsStyles.row, isLast ? undefined : settingsStyles.rowBorder]}
      testID={isOutbound ? "tunnels-row-outbound" : "tunnels-row-inbound"}
    >
      <View style={styles.rowContent}>
        {isOutbound ? (
          <View style={styles.mappingLine}>
            <View style={styles.endpointPill}>
              <Text testID="tunnels-row-local-port" style={styles.endpointMono} numberOfLines={1}>
                {localEndpoint}
              </Text>
            </View>
            <ThemedArrowRight size={13} />
            <View style={styles.endpointPill}>
              <Text style={styles.endpointMono} numberOfLines={1}>
                {remoteEndpoint}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {t("tunnels.inboundFrom", { port: entry.remotePort })}
            </Text>
          </View>
        )}
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        {entry.lastError ? (
          <Text style={styles.rowError} numberOfLines={2}>
            {entry.lastError}
          </Text>
        ) : undefined}
      </View>
      <View style={styles.rowTrailing}>''', f'''    <div
      className={{cn(settingsStyles.row, !isLast && settingsStyles.rowBorder)}}
      data-testid={{isOutbound ? "tunnels-row-outbound" : "tunnels-row-inbound"}}
    >
      <div className={{ROW_CONTENT}}>
        {{isOutbound ? (
          <div className="flex flex-row flex-wrap items-center gap-2">
            <div className="{PILL}">
              <span data-testid="tunnels-row-local-port" className="block truncate {MONO}">
                {{localEndpoint}}
              </span>
            </div>
            <ArrowRight size={{13}} className="shrink-0 text-muted-foreground" />
            <div className="{PILL}">
              <span className="block truncate {MONO}">{{remoteEndpoint}}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-row items-center gap-2">
            <span className="truncate text-sm leading-[normal] text-foreground">
              {{t("tunnels.inboundFrom", {{ port: entry.remotePort }})}}
            </span>
          </div>
        )}}
        <span className="truncate {SUBTITLE}">{{subtitle}}</span>
        {{entry.lastError ? (
          <span className="line-clamp-2 text-xs leading-[normal] text-red-300">
            {{entry.lastError}}
          </span>
        ) : undefined}}
      </div>
      <div className="flex flex-row items-center gap-2">''')
p.rep('''              testID="tunnels-row-delete"
            >
              <ThemedTrashIcon size={14} />
            </Button>
          </>
        ) : undefined}
      </View>
    </View>
  );
}''', '''              testID="tunnels-row-delete"
            >
              {TRASH_ICON}
            </Button>
          </>
        ) : undefined}
      </div>
    </div>
  );
}''')

# Allowlist
p.rep('''      <View style={settingsStyles.card}>
        <View style={[settingsStyles.row, styles.allowlistInputRow]}>
          <FormTextInput
            size="sm"
            style={styles.portInput}''', '''      <div className={settingsStyles.card}>
        <div className={cn(settingsStyles.row, "gap-2")}>
          <FormTextInput
            size="sm"
            className="flex-1"''')
# packages/app meant the allowlist field to fill the row (portInput: flex 1); on the web its
# FormTextInput dropped the style, leaving a ~100px field that cut off its own placeholder. Here it
# fills the row: a deliberate change, listed in the step 4 record.
p.rep('''            {saving ? t("tunnels.allowlist.saving") : t("tunnels.allowlist.add")}
          </Button>
        </View>
        {allowedPorts.length === 0 ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <Text style={styles.allowlistEmptyText}>{t("tunnels.allowlist.empty")}</Text>
          </View>
        ) : (
          allowedPorts.map((port) => (
            <View key={port} style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={styles.allowlistPortRow}>
                <View style={styles.endpointPill}>
                  <Text style={styles.endpointMono}>127.0.0.1:{port}</Text>
                </View>
                <Text style={styles.rowSubtitle}>{t("tunnels.allowlist.port", { port })}</Text>
              </View>''', f'''            {{saving ? t("tunnels.allowlist.saving") : t("tunnels.allowlist.add")}}
          </Button>
        </div>
        {{allowedPorts.length === 0 ? (
          <div className={{cn(settingsStyles.row, settingsStyles.rowBorder)}}>
            <span className="{SUBTITLE}">{{t("tunnels.allowlist.empty")}}</span>
          </div>
        ) : (
          allowedPorts.map((port) => (
            <div key={{port}} className={{cn(settingsStyles.row, settingsStyles.rowBorder)}}>
              <div className="flex flex-1 flex-row items-center gap-3">
                <div className="{PILL}">
                  <span className="{MONO}">127.0.0.1:{{port}}</span>
                </div>
                <span className="{SUBTITLE}">{{t("tunnels.allowlist.port", {{ port }})}}</span>
              </div>''')
p.rep('''                disabled={saving}
              >
                <ThemedTrashIcon size={14} />
              </Button>
            </View>
          ))
        )}
      </View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <Text style={styles.hint}>{t("tunnels.allowlist.hint")}</Text>
    </SettingsSection>''', f'''                disabled={{saving}}
              >
                {{TRASH_ICON}}
              </Button>
            </div>
          ))
        )}}
      </div>
      {{error ? <span className="block {INLINE_ERROR}">{{error}}</span> : undefined}}
      <span className="block {HINT}">{{t("tunnels.allowlist.hint")}}</span>
    </SettingsSection>''')

# Sheets
p.rep('''      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <Text style={styles.hint}>{t("tunnels.addForm.hint")}</Text>
      <View style={styles.sheetActions}>''', f'''      {{error ? <span className="{INLINE_ERROR}">{{error}}</span> : undefined}}
      <span className="{HINT}">{{t("tunnels.addForm.hint")}}</span>
      <div className={{SHEET_ACTIONS}}>''')
p.rep('''          {submitting ? t("tunnels.addForm.submitting") : t("tunnels.add")}
        </Button>
      </View>
    </AdaptiveModalSheet>''', '''          {submitting ? t("tunnels.addForm.submitting") : t("tunnels.add")}
        </Button>
      </div>
    </AdaptiveModalSheet>''')
p.rep('''      {error ? <Text style={styles.inlineError}>{error}</Text> : undefined}
      <View style={styles.sheetActions}>''', f'''      {{error ? <span className="{INLINE_ERROR}">{{error}}</span> : undefined}}
      <div className={{SHEET_ACTIONS}}>''')
p.rep('''          {resolveEditSaveButtonLabel(submitting, isZh, t)}
        </Button>
      </View>
    </AdaptiveModalSheet>''', '''          {resolveEditSaveButtonLabel(submitting, isZh, t)}
        </Button>
      </div>
    </AdaptiveModalSheet>''')
p.rep('''            placeholder={t("tunnels.addForm.passwordPlaceholder")}
            secureTextEntry''', '''            placeholder={t("tunnels.addForm.passwordPlaceholder")}
            type="password"''')
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const LOADING_ROW = "flex flex-row items-center gap-2 p-4";
const ROW_CONTENT = "flex min-w-0 flex-1 flex-col gap-1";
const SHEET_ACTIONS = "mt-2 flex flex-row justify-end gap-2";
'''
p.check()
p.write("the Tunnels page and its add / edit sheets; DOM view.", "tunnels-screen.py")
