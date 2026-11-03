// Port of archive/expo-app:packages/app/src/components/add-host-modal.tsx: the direct connection form; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/add-host-modals.py; edit it directly.
import {
  useCallback,
  useMemo,
  useReducer,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Link2 } from "lucide-react";
import type { HostProfile } from "@/types/host-connection";
import { useHosts, useHostMutations } from "@/runtime/host-runtime";
import {
  parseConnectionUri,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
} from "@/utils/daemon-endpoints";
import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { useThemeObject } from "~/app/theme-object";
import { Input } from "~/components/ui/input";

interface DirectConnectionDraft {
  host: string;
  port: string;
  useTls: boolean;
  password: string;
}

interface PreparedDirectConnection {
  uri: string;
  endpoint: string;
  useTls: boolean;
  password?: string;
}

interface DirectConnectionLabels {
  hostRequired: string;
  invalidPort: string;
  invalidConnection: string;
  failedToConnect: (endpoint: string) => string;
  noAdditionalDetails: (detail: string) => string;
  timedOut: string;
  refused: string;
  hostNotFound: string;
  hostUnreachable: string;
  tlsError: string;
  unableToConnect: string;
}

const LABEL = "text-sm leading-[normal] font-medium text-muted-foreground";

function isIpv6Host(host: string): boolean {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
}

function buildConnectionUriFromDraft(
  draft: DirectConnectionDraft,
  labels: DirectConnectionLabels,
): string {
  const host = draft.host.trim();
  const port = Number(draft.port.trim());
  if (!host) {
    throw new Error(labels.hostRequired);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(labels.invalidPort);
  }

  return serializeConnectionUriForStorage({
    host,
    port,
    isIpv6: isIpv6Host(host),
    useTls: draft.useTls,
    ...(draft.password ? { password: draft.password } : {}),
  });
}

function prepareDirectConnection(
  draft: DirectConnectionDraft,
  labels: DirectConnectionLabels,
): PreparedDirectConnection {
  const parsed = parseConnectionUri(buildConnectionUriFromDraft(draft, labels));
  const endpoint = parsed.isIpv6
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;

  return {
    uri: serializeConnectionUri(parsed),
    endpoint,
    useTls: parsed.useTls,
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

function draftFromConnectionUri(uri: string): DirectConnectionDraft {
  const parsed = parseConnectionUri(uri);
  return {
    host: parsed.host,
    port: String(parsed.port),
    useTls: parsed.useTls,
    password: parsed.password ?? "",
  };
}

function normalizeTransportMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed;
}

function formatTechnicalTransportDetails(
  details: (string | null)[],
  labels: DirectConnectionLabels,
): string | null {
  const unique = Array.from(
    new Set(
      details
        .map((value) => normalizeTransportMessage(value))
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  if (unique.length === 0) return null;

  const allGeneric = unique.every((value) => {
    const lower = value.toLowerCase();
    return lower === "transport error" || lower === "transport closed";
  });

  if (allGeneric) {
    return labels.noAdditionalDetails(unique[0] ?? "");
  }

  return unique.join(" — ");
}

function buildConnectionFailureCopy(input: {
  endpoint: string;
  error: unknown;
  labels: DirectConnectionLabels;
}): { title: string; detail: string | null; raw: string | null } {
  const { endpoint, error, labels } = input;
  const title = labels.failedToConnect(endpoint);

  const raw = (() => {
    if (error instanceof DaemonConnectionTestError) {
      return (
        formatTechnicalTransportDetails([error.reason, error.lastError], labels) ??
        normalizeTransportMessage(error.message)
      );
    }
    if (error instanceof Error) {
      return normalizeTransportMessage(error.message);
    }
    return null;
  })();

  const rawLower = raw?.toLowerCase() ?? "";
  let detail: string | null = null;

  if (raw === "Incorrect password" || raw === "Password required") {
    detail = raw;
  } else if (rawLower.includes("timed out")) {
    detail = labels.timedOut;
  } else if (
    rawLower.includes("econnrefused") ||
    rawLower.includes("connection refused") ||
    rawLower.includes("err_connection_refused")
  ) {
    detail = labels.refused;
  } else if (rawLower.includes("enotfound") || rawLower.includes("not found")) {
    detail = labels.hostNotFound;
  } else if (rawLower.includes("ehostunreach") || rawLower.includes("host is unreachable")) {
    detail = labels.hostUnreachable;
  } else if (
    rawLower.includes("certificate") ||
    rawLower.includes("tls") ||
    rawLower.includes("ssl")
  ) {
    detail = labels.tlsError;
  } else {
    detail = labels.unableToConnect;
  }

  return { title, detail, raw };
}

export interface AddHostModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function AddHostModal({ visible, onClose, onCancel, onSaved }: AddHostModalProps) {
  const theme = useThemeObject();
  const { t } = useTranslation();
  const daemons = useHosts();
  const { probeAndUpsertDirectConnection } = useHostMutations();

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [host, setHost] = useState("");
  const handleHostInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setHost(event.target.value),
    [setHost],
  );
  const [port, setPort] = useState("6777");
  const handlePortInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPort(event.target.value),
    [setPort],
  );
  const [useTls, setUseTls] = useState(false);
  const [password, setPassword] = useState("");
  const handlePasswordInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
    [setPassword],
  );
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedUri, setAdvancedUri] = useState("");
  const handleAdvancedUriInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setAdvancedUri(event.target.value),
    [setAdvancedUri],
  );
  const [inputResetKey, bumpInputResetKey] = useReducer((key: number) => key + 1, 0);

  const clearInput = useCallback(() => {
    setHost("");
    setPort("6777");
    setUseTls(false);
    setPassword("");
    setIsPasswordVisible(false);
    setIsAdvancedOpen(false);
    setAdvancedUri("");
    bumpInputResetKey();
  }, []);

  const connectIcon = useMemo(
    () => <Link2 size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );
  const directConnectionLabels = useMemo<DirectConnectionLabels>(
    () => ({
      hostRequired: t("pairing.direct.errors.hostRequired"),
      invalidPort: t("pairing.direct.errors.invalidPort"),
      invalidConnection: t("pairing.direct.errors.invalidConnection"),
      failedToConnect: (endpoint) => t("pairing.direct.errors.failedToConnect", { endpoint }),
      noAdditionalDetails: (detail) => t("pairing.direct.errors.noAdditionalDetails", { detail }),
      timedOut: t("pairing.direct.errors.timedOut"),
      refused: t("pairing.direct.errors.refused"),
      hostNotFound: t("pairing.direct.errors.hostNotFound"),
      hostUnreachable: t("pairing.direct.errors.hostUnreachable"),
      tlsError: t("pairing.direct.errors.tlsError"),
      unableToConnect: t("pairing.direct.errors.unableToConnect"),
    }),
    [t],
  );
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.direct.title") }), [t]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    let connection: PreparedDirectConnection;
    try {
      connection = prepareDirectConnection(
        { host, port, useTls, password },
        directConnectionLabels,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : directConnectionLabels.invalidConnection;
      setErrorMessage(message);
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { profile, serverId, hostname } = await probeAndUpsertDirectConnection({
        endpoint: connection.endpoint,
        useTls: connection.useTls,
        ...(connection.password ? { password: connection.password } : {}),
      });
      const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);

      onSaved?.({ profile, serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const {
        title,
        detail,
        raw: rawDetail,
      } = buildConnectionFailureCopy({
        endpoint: connection.uri,
        error,
        labels: directConnectionLabels,
      });
      let combined: string;
      if (rawDetail && detail && rawDetail !== detail) {
        combined = `${title}\n${detail}\n${t("pairing.direct.errors.details", {
          detail: rawDetail,
        })}`;
      } else if (detail) {
        combined = `${title}\n${detail}`;
      } else {
        combined = title;
      }
      setErrorMessage(combined);
    } finally {
      setIsSaving(false);
    }
  }, [
    daemons,
    directConnectionLabels,
    handleClose,
    host,
    isSaving,
    onSaved,
    password,
    port,
    probeAndUpsertDirectConnection,
    t,
    useTls,
  ]);

  const handleSubmitEditing = useCallback(() => {
    void handleSave();
  }, [handleSave]);
  const handleSubmitEditingEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleSubmitEditing();
    },
    [handleSubmitEditing],
  );

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleToggleUseTls = useCallback(() => {
    if (isSaving) return;
    setUseTls((current) => !current);
  }, [isSaving]);

  const handleTogglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((current) => !current);
  }, []);

  const handleToggleAdvanced = useCallback(() => {
    if (!isAdvancedOpen) {
      try {
        setAdvancedUri(
          buildConnectionUriFromDraft({ host, port, useTls, password }, directConnectionLabels),
        );
      } catch {
        setAdvancedUri("");
      }
      setErrorMessage("");
      setIsAdvancedOpen(true);
      return;
    }

    try {
      const next = draftFromConnectionUri(advancedUri);
      setHost(next.host);
      setPort(next.port);
      setUseTls(next.useTls);
      setPassword(next.password);
      setErrorMessage("");
      bumpInputResetKey();
    } catch {
      setErrorMessage("");
    }
    setIsAdvancedOpen(false);
  }, [advancedUri, directConnectionLabels, host, isAdvancedOpen, password, port, useTls]);
  const handleToggleAdvancedEnter = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) handleToggleAdvanced();
    },
    [handleToggleAdvanced],
  );

  const AdvancedIcon = isAdvancedOpen ? ChevronDown : ChevronRight;
  const PasswordIcon = isPasswordVisible ? EyeOff : Eye;

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="add-host-modal"
    >
      <span className="text-sm leading-[normal] text-muted-foreground">
        {t("pairing.direct.helper")}
      </span>

      <div className="flex flex-row gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={LABEL}>{t("pairing.direct.fields.host")}</span>
          <Input
            data-testid="direct-host-input"
            aria-label={t("pairing.direct.fields.host")}
            defaultValue={host}
            key={`direct-host-${inputResetKey}`}
            onChange={handleHostInput}
            placeholder="localhost"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            readOnly={isSaving}
            enterKeyHint="next"
          />
        </div>
        <div className="flex w-28 flex-col gap-2">
          <span className={LABEL}>{t("pairing.direct.fields.port")}</span>
          <Input
            data-testid="direct-port-input"
            aria-label={t("pairing.direct.fields.port")}
            defaultValue={port}
            key={`direct-port-${inputResetKey}`}
            onChange={handlePortInput}
            placeholder="6777"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="numeric"
            readOnly={isSaving}
            enterKeyHint="done"
            onKeyDown={handleSubmitEditingEnter}
          />
        </div>
      </div>

      <button
        type="button"
        role="checkbox"
        className="flex flex-row items-center gap-3 self-start text-left disabled:opacity-50"
        onClick={handleToggleUseTls}
        disabled={isSaving}
        aria-label={t("pairing.direct.fields.useSsl")}
        aria-checked={useTls}
        data-testid="direct-ssl-toggle"
      >
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
            useTls ? "border-primary bg-primary" : "border-input bg-background dark:bg-input/30",
          )}
        >
          {useTls ? (
            <span className="flex" data-testid="direct-ssl-toggle-checked">
              <Check size={12} strokeWidth={3} color={theme.colors.accentForeground} />
            </span>
          ) : null}
        </span>
        <span className={LABEL}>{t("pairing.direct.fields.useSsl")}</span>
      </button>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>{t("pairing.direct.fields.password")}</span>
        <div className="flex flex-row items-center gap-2">
          <Input
            data-testid="direct-password-input"
            aria-label={t("pairing.direct.fields.password")}
            defaultValue={password}
            key={`direct-password-${inputResetKey}`}
            onChange={handlePasswordInput}
            placeholder={t("pairing.direct.fields.optional")}
            className="min-w-0 flex-1"
            autoCapitalize="none"
            autoCorrect="off"
            type={isPasswordVisible ? "text" : "password"}
            readOnly={isSaving}
            enterKeyHint="done"
            onKeyDown={handleSubmitEditingEnter}
          />
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted"
            onClick={handleTogglePasswordVisibility}
            disabled={isSaving}
            aria-label={
              isPasswordVisible
                ? t("pairing.direct.passwordVisibility.hide")
                : t("pairing.direct.passwordVisibility.show")
            }
            data-testid="direct-password-visibility-toggle"
          >
            <PasswordIcon size={18} color={theme.colors.foregroundMuted} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="flex flex-row items-center gap-2 self-start py-1"
          onClick={handleToggleAdvanced}
          disabled={isSaving}
          aria-label={
            isAdvancedOpen ? t("pairing.direct.advanced.hide") : t("pairing.direct.advanced.show")
          }
          data-testid="direct-host-advanced-toggle"
        >
          <AdvancedIcon size={16} color={theme.colors.foregroundMuted} />
          <span className="text-sm leading-[normal] font-medium text-foreground">
            {t("pairing.direct.advanced.label")}
          </span>
        </button>
        {isAdvancedOpen ? (
          <Input
            data-testid="direct-host-uri-input"
            aria-label={t("pairing.direct.fields.connectionUri")}
            defaultValue={advancedUri}
            key={`direct-host-uri-${inputResetKey}`}
            onChange={handleAdvancedUriInput}
            placeholder="tcp://localhost:6777?ssl=true"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            readOnly={isSaving}
            enterKeyHint="done"
            onKeyDown={handleToggleAdvancedEnter}
          />
        ) : null}
        {errorMessage ? (
          <span className="whitespace-pre-line text-sm leading-[normal] text-destructive">
            {errorMessage}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-row gap-3">
        <Button className="flex-1" variant="secondary" onClick={handleCancel} disabled={isSaving}>
          {t("pairing.direct.actions.cancel")}
        </Button>
        <Button
          className="flex-1"
          variant="default"
          onClick={handleSavePress}
          data-testid="direct-host-submit"
          disabled={isSaving}
        >
          {connectIcon}
          {isSaving ? t("pairing.direct.actions.connecting") : t("pairing.direct.actions.connect")}
        </Button>
      </div>
    </AdaptiveModalSheet>
  );
}
