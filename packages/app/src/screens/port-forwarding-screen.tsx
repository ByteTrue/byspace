import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useIsFocused } from "@react-navigation/native";
import { ArrowRight, Cable, Copy, Play, Square } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import {
  createPortForwardDraft,
  preparePortForward,
  reconcilePortForwardDraft,
  type PortForwardDraft,
  type PortForwardFieldError,
  type PortForwardHostChoice,
} from "@/port-forward/port-forward-form";
import {
  portForwardKey,
  stopTrackedPortForward,
  trackPortForward,
  usePortForwardRuntimeStore,
  type TrackedPortForward,
} from "@/port-forward/port-forward-runtime-store";
import {
  openPortForward,
  PortForwardServiceError,
  type PortForwardServiceErrorCode,
} from "@/port-forward/port-forward-service";
import { ICON_SIZE } from "@/styles/theme";

function useEligibleHosts(): PortForwardHostChoice[] {
  const hosts = useHosts();
  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(hostIds);
  const support = useHostFeatureMap(hostIds, "remoteTcpForward");

  return useMemo(
    () =>
      hosts
        .filter(
          (host) => statuses.get(host.serverId) === "online" && support.get(host.serverId) === true,
        )
        .map((host) => ({ serverId: host.serverId, label: host.label })),
    [hosts, statuses, support],
  );
}

export function PortForwardingScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) return <View style={styles.container} />;
  return <PortForwardingScreenContent />;
}

function PortForwardingScreenContent(): ReactElement {
  const { t } = useTranslation();
  const eligibleHosts = useEligibleHosts();
  const allHosts = useHosts();
  const forwards = usePortForwardRuntimeStore((state) => state.forwards);
  const [draft, setDraft] = useState<PortForwardDraft>(() => createPortForwardDraft(eligibleHosts));
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) => reconcilePortForwardDraft(current, eligibleHosts));
  }, [eligibleHosts]);

  const hostLabelById = useMemo(
    () => new Map(allHosts.map((host) => [host.serverId, host.label] as const)),
    [allHosts],
  );
  const sourceOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      eligibleHosts.map((host) => ({
        id: host.serverId,
        value: host.serverId,
        label: host.label,
      })),
    [eligibleHosts],
  );
  const targetOptions = useMemo<SelectFieldOption<string>[]>(
    () => sourceOptions.filter((option) => option.value !== draft.sourceServerId),
    [draft.sourceServerId, sourceOptions],
  );
  const sourceDisplay = useMemo(
    () => sourceOptions.find((option) => option.value === draft.sourceServerId) ?? null,
    [draft.sourceServerId, sourceOptions],
  );
  const targetDisplay = useMemo(
    () => targetOptions.find((option) => option.value === draft.targetServerId) ?? null,
    [draft.targetServerId, targetOptions],
  );
  const validation = useMemo(() => preparePortForward(draft), [draft]);

  const fieldError = useCallback(
    (code: PortForwardFieldError | undefined) => {
      if (!submitted || !code) return null;
      if (code === "hosts-must-differ") return t("portForwarding.errors.hostsMustDiffer");
      if (code === "invalid-port") return t("portForwarding.errors.invalidPort");
      return t("portForwarding.errors.hostRequired");
    },
    [submitted, t],
  );

  const setField = useCallback(
    (field: keyof PortForwardDraft, value: string) => {
      setDraft((current) => {
        const next = { ...current, [field]: value };
        return field === "sourceServerId" ? reconcilePortForwardDraft(next, eligibleHosts) : next;
      });
      setError(null);
    },
    [eligibleHosts],
  );

  const serviceError = useCallback(
    (caught: unknown) => {
      const code = caught instanceof PortForwardServiceError ? caught.code : null;
      const keys: Record<PortForwardServiceErrorCode, string> = {
        "source-unavailable": "portForwarding.errors.sourceUnavailable",
        "target-unavailable": "portForwarding.errors.targetUnavailable",
        "source-update-required": "portForwarding.errors.updateRequired",
        "target-update-required": "portForwarding.errors.updateRequired",
        "target-relay-disabled": "portForwarding.errors.relayDisabled",
        "invalid-target-offer": "portForwarding.errors.invalidOffer",
      };
      return code ? t(keys[code]) : t("portForwarding.errors.startFailed");
    },
    [t],
  );

  const startForward = useCallback(async () => {
    setSubmitted(true);
    if (!validation.value || pending) return;
    setPending(true);
    setError(null);
    try {
      const runtime = getHostRuntimeStore();
      const { forward, sourceClient } = await openPortForward(validation.value, (serverId) =>
        runtime.getClient(serverId),
      );
      trackPortForward(forward, sourceClient);
      setDraft((current) => ({ ...current, localPort: "" }));
      setSubmitted(false);
    } catch (caught) {
      setError(serviceError(caught));
    } finally {
      setPending(false);
    }
  }, [pending, serviceError, validation.value]);

  const setSourceHost = useCallback(
    (value: string) => setField("sourceServerId", value),
    [setField],
  );
  const setTargetHost = useCallback(
    (value: string) => setField("targetServerId", value),
    [setField],
  );
  const setTargetPort = useCallback((value: string) => setField("targetPort", value), [setField]);
  const setLocalPort = useCallback((value: string) => setField("localPort", value), [setField]);
  const submitForward = useCallback(() => {
    void startForward();
  }, [startForward]);

  return (
    <View style={styles.container}>
      <MenuHeader title={t("portForwarding.title")} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="port-forwarding-page"
      >
        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("portForwarding.newForward")}</Text>
          </View>

          {eligibleHosts.length >= 2 ? (
            <View style={styles.formSurface} testID="port-forwarding-form">
              <View style={styles.formFields}>
                <View style={styles.hostField}>
                  <SelectField
                    label={t("portForwarding.sourceHost")}
                    value={draft.sourceServerId || null}
                    selectedDisplay={sourceDisplay}
                    options={sourceOptions}
                    onChange={setSourceHost}
                    placeholder={t("portForwarding.selectHost")}
                    emptyText={t("portForwarding.noHosts")}
                    error={fieldError(validation.errors.sourceServerId)}
                    searchable={sourceOptions.length > 6}
                    testID="port-forward-source"
                  />
                </View>
                <View style={styles.hostField}>
                  <SelectField
                    label={t("portForwarding.targetHost")}
                    value={draft.targetServerId || null}
                    selectedDisplay={targetDisplay}
                    options={targetOptions}
                    onChange={setTargetHost}
                    placeholder={t("portForwarding.selectHost")}
                    emptyText={t("portForwarding.noHosts")}
                    error={fieldError(validation.errors.targetServerId)}
                    searchable={targetOptions.length > 6}
                    testID="port-forward-target"
                  />
                </View>
                <PortInputField
                  label={t("portForwarding.targetPort")}
                  value={draft.targetPort}
                  placeholder="5173"
                  error={fieldError(validation.errors.targetPort)}
                  onChange={setTargetPort}
                  onSubmit={submitForward}
                  testID="port-forward-target-port"
                />
                <PortInputField
                  label={t("portForwarding.localPort")}
                  hint={t("portForwarding.localPortHint")}
                  value={draft.localPort}
                  placeholder={t("portForwarding.auto")}
                  error={fieldError(validation.errors.localPort)}
                  onChange={setLocalPort}
                  onSubmit={submitForward}
                  testID="port-forward-local-port"
                />
              </View>
              {error ? (
                <Text
                  style={styles.formError}
                  accessibilityRole="alert"
                  testID="port-forward-error"
                >
                  {error}
                </Text>
              ) : null}
              <View style={styles.formActions}>
                <Button
                  variant="default"
                  leftIcon={Play}
                  loading={pending}
                  onPress={submitForward}
                  testID="port-forward-start"
                >
                  {t("portForwarding.start")}
                </Button>
              </View>
            </View>
          ) : (
            <View style={styles.emptyState} testID="port-forwarding-hosts-empty">
              <Cable size={ICON_SIZE.lg} color={styles.emptyIcon.color} />
              <Text style={styles.emptyTitle}>{t("portForwarding.needTwoHosts")}</Text>
              <Text style={styles.emptyDescription}>
                {t("portForwarding.needTwoHostsDescription")}
              </Text>
            </View>
          )}

          <View style={styles.activeSection}>
            <View style={styles.activeHeader}>
              <Text style={styles.sectionTitle}>{t("portForwarding.activeForwards")}</Text>
              {forwards.length > 0 ? (
                <Text style={styles.count} testID="port-forward-count">
                  {forwards.length}
                </Text>
              ) : null}
            </View>
            {forwards.length === 0 ? (
              <Text style={styles.noForwards} testID="port-forwarding-empty">
                {t("portForwarding.noActiveForwards")}
              </Text>
            ) : (
              <View style={styles.forwardList}>
                {forwards.map((forward) => (
                  <ForwardRow
                    key={portForwardKey(forward)}
                    forward={forward}
                    sourceLabel={
                      hostLabelById.get(forward.sourceServerId) ?? forward.sourceServerId
                    }
                    targetLabel={
                      hostLabelById.get(forward.targetServerId) ?? forward.targetServerId
                    }
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function PortInputField({
  label,
  hint,
  value,
  placeholder,
  error,
  onChange,
  onSubmit,
  testID,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  testID: string;
}): ReactElement {
  return (
    <View style={styles.portField}>
      <Field label={label} hint={hint} error={error} testID={testID}>
        <FormTextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder={placeholder}
          onSubmitEditing={onSubmit}
          testID={`${testID}-input`}
        />
      </Field>
    </View>
  );
}

function ForwardRow({
  forward,
  sourceLabel,
  targetLabel,
}: {
  forward: TrackedPortForward;
  sourceLabel: string;
  targetLabel: string;
}): ReactElement {
  const { t } = useTranslation();
  const [copying, setCopying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const key = portForwardKey(forward);
  const address = `${forward.localHost}:${forward.localPort}`;
  const statusLabel = t(
    forward.status === "stopping"
      ? "portForwarding.status.stopping"
      : "portForwarding.status.active",
  );

  const copyAddress = useCallback(async () => {
    setCopying(true);
    setActionError(null);
    try {
      await Clipboard.setStringAsync(address);
    } catch {
      setActionError(t("portForwarding.errors.copyFailed"));
    } finally {
      setCopying(false);
    }
  }, [address, t]);

  const stopForward = useCallback(async () => {
    setActionError(null);
    try {
      await stopTrackedPortForward(key);
    } catch {
      setActionError(t("portForwarding.errors.stopFailed"));
    }
  }, [key, t]);
  const copyButtonStyle = useCallback(
    (state: PressableStateCallbackType) => iconButtonStyle(state, copying),
    [copying],
  );
  const stopButtonStyle = useCallback(
    (state: PressableStateCallbackType) => iconButtonStyle(state, forward.status === "stopping"),
    [forward.status],
  );

  return (
    <View style={styles.forwardRow} testID={`port-forward-row-${forward.forwardId}`}>
      <View style={styles.forwardIcon}>
        <Cable size={ICON_SIZE.md} color={styles.forwardIconGlyph.color} />
      </View>
      <View style={styles.forwardMain}>
        <View style={styles.forwardRoute}>
          <Text style={styles.address} selectable>
            {address}
          </Text>
          <ArrowRight size={ICON_SIZE.sm} color={styles.routeArrow.color} />
          <Text style={styles.target} numberOfLines={1}>
            {targetLabel}:{forward.targetPort}
          </Text>
        </View>
        <Text style={styles.forwardMeta} numberOfLines={1}>
          {sourceLabel} · {statusLabel}
        </Text>
        {actionError ? (
          <Text style={styles.actionError} accessibilityRole="alert">
            {actionError}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowActions}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("portForwarding.copyAddress")}
              disabled={copying}
              hitSlop={6}
              onPress={copyAddress}
              style={copyButtonStyle}
              testID={`port-forward-copy-${forward.forwardId}`}
            >
              <Copy size={ICON_SIZE.sm} color={styles.actionIcon.color} />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t("portForwarding.copyAddress")}</Text>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("portForwarding.stop")}
              disabled={forward.status === "stopping"}
              hitSlop={6}
              onPress={stopForward}
              style={stopButtonStyle}
              testID={`port-forward-stop-${forward.forwardId}`}
            >
              <Square size={ICON_SIZE.sm} color={styles.actionIcon.color} />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{t("portForwarding.stop")}</Text>
          </TooltipContent>
        </Tooltip>
      </View>
    </View>
  );
}

function iconButtonStyle({ pressed, hovered }: PressableStateCallbackType, disabled: boolean) {
  return [
    styles.iconButton,
    hovered && !disabled ? styles.iconButtonHovered : null,
    pressed && !disabled ? styles.iconButtonPressed : null,
    disabled ? styles.iconButtonDisabled : null,
  ];
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[12],
  },
  content: {
    width: "100%",
    maxWidth: 1040,
    alignSelf: "center",
    gap: theme.spacing[8],
  },
  sectionHeader: {
    gap: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  formSurface: {
    marginTop: -theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: { xs: theme.spacing[4], md: theme.spacing[6] },
    gap: theme.spacing[4],
  },
  formFields: {
    flexDirection: { xs: "column", lg: "row" },
    alignItems: { xs: "stretch", lg: "flex-start" },
    gap: theme.spacing[3],
  },
  hostField: {
    flex: 1,
    minWidth: { xs: 0, lg: 190 },
  },
  portField: {
    width: { xs: "100%", lg: 132 },
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  formError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  emptyState: {
    marginTop: -theme.spacing[4],
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[6],
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 480,
  },
  activeSection: {
    gap: theme.spacing[3],
  },
  activeHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: theme.spacing[1],
    borderRadius: 11,
    backgroundColor: theme.colors.surface3,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    lineHeight: 22,
  },
  noForwards: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
  },
  forwardList: {
    gap: theme.spacing[2],
  },
  forwardRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[4] },
    paddingVertical: theme.spacing[3],
  },
  forwardIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface3,
  },
  forwardIconGlyph: {
    color: theme.colors.foregroundMuted,
  },
  forwardMain: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  forwardRoute: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: { xs: "wrap", md: "nowrap" },
    gap: theme.spacing[2],
  },
  address: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  routeArrow: {
    color: theme.colors.foregroundMuted,
  },
  target: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  forwardMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  actionError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  iconButtonPressed: {
    opacity: 0.75,
  },
  iconButtonDisabled: {
    opacity: theme.opacity[50],
  },
  actionIcon: {
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
}));
