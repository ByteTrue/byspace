"""Port packages/app's settings/pair-device-section.tsx to web/src/overrides: same logic, DOM +
Tailwind view. The QR code is the qrcode package's SVG string, put in the page as markup."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("settings/pair-device-section.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { SvgXml } from "react-native-svg";\n', "")
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('const FLEX_ONE_STYLE = { flex: 1 } as const;\n', "")
p.rep('''    <View testID="pair-device-content">''', '''    <div data-testid="pair-device-content">''')
p.rep('''        onCopy={handleCopyPress}
      />
    </View>''', '''        onCopy={handleCopyPress}
      />
    </div>''')
STATE_LINE = "block py-6 text-center text-sm leading-[normal] text-muted-foreground"
p.rep('''    return <Text style={styles.stateLine}>{t("pairing.device.loadingOffer")}</Text>;''',
      f'''    return <span className="{STATE_LINE}">{{t("pairing.device.loadingOffer")}}</span>;''')
p.rep('''    return <Text style={styles.stateLine}>{t("pairing.device.unavailable")}</Text>;''',
      f'''    return <span className="{STATE_LINE}">{{t("pairing.device.unavailable")}}</span>;''')
p.rep('''    <View style={styles.consent}>
      <View style={styles.hero}>
        <RelayHeroBadge />
        <Text style={styles.consentTitle}>{t("pairing.device.enableTitle")}</Text>
        <Text style={styles.consentDescription}>{t("pairing.device.enableDescription")}</Text>''',
      '''    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-2">
        <RelayHeroBadge />
        <span className="text-sm leading-[normal] font-medium text-foreground">
          {t("pairing.device.enableTitle")}
        </span>
        <span className="text-sm leading-[21px] text-muted-foreground">
          {t("pairing.device.enableDescription")}
        </span>''')
p.rep('''        />
      </View>
      {props.enableError ?''', '''        />
      </div>
      {props.enableError ?''')
p.rep('''      <View style={styles.actions}>
        <Button variant="secondary" style={FLEX_ONE_STYLE} onPress={props.onClose}>''',
      '''      <div className="flex flex-row gap-3">
        <Button variant="secondary" className="flex-1" onPress={props.onClose}>''')
p.rep('''            variant="default"
            style={FLEX_ONE_STYLE}''', '''            variant="default"
            className="flex-1"''')
p.rep('''        ) : null}
      </View>
      <View style={styles.directRow}>
        <ThemedNetwork size={14} style={styles.directIcon} />
        <Text style={styles.directHint}>{t("pairing.device.directConnectionHint")}</Text>
      </View>
    </View>''', '''        ) : null}
      </div>
      <div className="flex flex-row items-start gap-2 border-t pt-4">
        {/* mt-px: seats the glyph on the hint's first text line */}
        <ThemedNetwork size={14} className="mt-px shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-xs leading-[18px] text-muted-foreground">
          {t("pairing.device.directConnectionHint")}
        </span>
      </div>
    </div>''')
p.rep('''    <View style={styles.heroBadge}>
      <ThemedShieldCheck size={20} uniProps={accentBrightColorMapping} />
    </View>''', '''    <div className="mb-1 flex size-12 items-center justify-center rounded-full border bg-muted">
      <ThemedShieldCheck size={20} uniProps={accentBrightColorMapping} />
    </div>''')
p.rep('''    <View style={styles.offer}>
      <Text style={styles.offerHint}>{t("pairing.device.hint")}</Text>
      <View style={styles.qrTile}>
        <PairingQr svg={props.qrSvg} isError={props.qrError} />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.linkInput}''', '''    <div className="flex flex-col gap-4">
      <span className="text-center text-sm leading-[normal] text-muted-foreground">
        {t("pairing.device.hint")}
      </span>
      <div className="flex aspect-square w-[304px] max-w-full items-center justify-center self-center rounded-xl border bg-white p-3">
        <PairingQr svg={props.qrSvg} isError={props.qrError} />
      </div>
      <div className="flex flex-row items-center gap-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted">
          <TextInput
            ref={inputRef}
            // UI font, as packages/app's root font rule renders it (see host-page.py)
            className="block w-full bg-transparent px-3 py-2 text-xs leading-[normal] text-muted-foreground outline-none"''')
p.rep('''            accessibilityLabel={t("pairing.link.label")}
          />
        </View>''', '''            accessibilityLabel={t("pairing.link.label")}
          />
        </div>''')
p.rep('''        </Button>
      </View>
      <Alert variant="warning" description={t("pairing.device.securityWarning")} />
    </View>''', '''        </Button>
      </div>
      <Alert variant="warning" description={t("pairing.device.securityWarning")} />
    </div>''')
p.rep('''function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  if (svg) {''', '''function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  const markup = useMemo(() => (svg ? { __html: svg } : null), [svg]);
  if (markup) {''')
p.rep('''    return (
      <SvgXml
        xml={svg}
        style={styles.qrImage}
        accessibilityRole="image"
        accessibilityLabel={t("pairing.device.qrAccessibility")}
      />
    );''', '''    return (
      // The qrcode package's own SVG markup, scaled to the tile.
      <div
        role="img"
        aria-label={t("pairing.device.qrAccessibility")}
        className="size-full [&>svg]:size-full"
        dangerouslySetInnerHTML={markup}
      />
    );''')
p.rep('''    return <Text style={styles.hint}>{t("pairing.device.qrUnavailable")}</Text>;''',
      '''    return (
      <span className="text-xs leading-[normal] text-muted-foreground">
        {t("pairing.device.qrUnavailable")}
      </span>
    );''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the pairing offer (relay consent, QR code, link), DOM view.", "pair-device-section.py")
