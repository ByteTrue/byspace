import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { useAgentProfiles } from "@/agent-profiles/internal/use-agent-profiles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { toErrorMessage } from "@/lib/error-messages";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SelectField, type SelectFieldOption } from "@/widgets/select-field";
import {
  AGENT_PROFILE_TIER_RANKS,
  CHIEF_LANDING_STRATEGIES,
  CHIEF_MISSION_TIERS,
  CHIEF_ROLE_KEYS,
  resolveAgentProfileTier,
  type AgentProfile,
  type AgentProfileTier,
  type ChiefConfig,
  type ChiefConfigPatch,
  type ChiefLandingMode,
  type ChiefLandingStrategy,
  type ChiefMissionTier,
  type ChiefRoleKey,
  type ChiefRoleRoutingEntry,
} from "@bytetrue/protocol/messages";
import equal from "fast-deep-equal";
import { CircleAlert, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";

export type ChiefTranslateFn = (key: string, values?: Record<string, string | number>) => string;

const DEFAULT_CHIEF_TIER: ChiefMissionTier = "L1";
const DEFAULT_SOFT_STALL_SEC = 600;
const DEFAULT_HARD_STALL_SEC = 1200;
const DEFAULT_LANDING_REQUIRE_APPROVAL = true;
const DEFAULT_LANDING_MODE: ChiefLandingMode = "merge_local";
const DEFAULT_LANDING_STRATEGY: ChiefLandingStrategy = "squash";
const SUPPORTED_LANDING_MODES: readonly ChiefLandingMode[] = [DEFAULT_LANDING_MODE];
const UNASSIGNED_PROFILE_VALUE = "";
const EMPTY_PROFILES: readonly AgentProfile[] = [];

export interface ChiefRoleRoutingDraft {
  primaryProfileId: string;
  fallbackProfileIds: string[];
}

export interface ChiefRoutingDraft {
  defaultTier: ChiefMissionTier;
  roles: Record<ChiefRoleKey, ChiefRoleRoutingDraft>;
  softWarningSecInput: string;
  hardRecoverySecInput: string;
  requireHumanApproval: boolean;
  landingMode: ChiefLandingMode;
  landingStrategy: ChiefLandingStrategy;
}

export interface ChiefRoutingValidation {
  isValid: boolean;
  stallError: string | null;
  verifierTierError: string | null;
  verifierFallbackWarning: string | null;
  roleErrors: Partial<Record<ChiefRoleKey, string>>;
}

function emptyRoleDraft(): ChiefRoleRoutingDraft {
  return { primaryProfileId: "", fallbackProfileIds: [] };
}

function normalizeRoleDraft(
  entry: ChiefRoleRoutingEntry | null | undefined,
): ChiefRoleRoutingDraft {
  if (!entry) {
    return emptyRoleDraft();
  }
  const primaryProfileId = entry.primaryProfileId.trim();
  if (!primaryProfileId) {
    return emptyRoleDraft();
  }
  const seen = new Set<string>([primaryProfileId]);
  const fallbackProfileIds: string[] = [];
  for (const id of entry.fallbackProfileIds ?? []) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    fallbackProfileIds.push(trimmed);
  }
  return { primaryProfileId, fallbackProfileIds };
}

function buildRolesDraft(roles: ChiefConfig["roles"]): Record<ChiefRoleKey, ChiefRoleRoutingDraft> {
  return {
    chief: normalizeRoleDraft(roles?.chief),
    author: normalizeRoleDraft(roles?.author),
    verifier: normalizeRoleDraft(roles?.verifier),
    integrator: normalizeRoleDraft(roles?.integrator),
  };
}

function buildStallDraft(stall: ChiefConfig["stall"]): {
  softWarningSecInput: string;
  hardRecoverySecInput: string;
} {
  return {
    softWarningSecInput: String(stall?.softWarningSec ?? DEFAULT_SOFT_STALL_SEC),
    hardRecoverySecInput: String(stall?.hardRecoverySec ?? DEFAULT_HARD_STALL_SEC),
  };
}

function buildLandingDraft(landing: ChiefConfig["landing"]): {
  requireHumanApproval: boolean;
  landingMode: ChiefLandingMode;
  landingStrategy: ChiefLandingStrategy;
} {
  return {
    requireHumanApproval: landing?.requireHumanApproval ?? DEFAULT_LANDING_REQUIRE_APPROVAL,
    landingMode: landing?.mode === DEFAULT_LANDING_MODE ? landing.mode : DEFAULT_LANDING_MODE,
    landingStrategy: landing?.strategy ?? DEFAULT_LANDING_STRATEGY,
  };
}

export function buildChiefRoutingDraft(chief: ChiefConfig | undefined): ChiefRoutingDraft {
  return {
    defaultTier: chief?.defaultTier ?? DEFAULT_CHIEF_TIER,
    roles: buildRolesDraft(chief?.roles),
    ...buildStallDraft(chief?.stall),
    ...buildLandingDraft(chief?.landing),
  };
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function buildProfileIndex(profiles: readonly AgentProfile[]): Map<string, AgentProfile> {
  const index = new Map<string, AgentProfile>();
  for (const profile of profiles) {
    const id = profile.id.trim();
    if (id) {
      index.set(id, profile);
    }
    const name = profile.name.trim();
    if (name && !index.has(name)) {
      index.set(name, profile);
    }
  }
  return index;
}

function formatTierLabel(tier: AgentProfileTier, t: ChiefTranslateFn): string {
  return t(`settings.host.agentProfiles.tiers.${tier}`);
}

export function validateChiefRoutingDraft(
  draft: ChiefRoutingDraft,
  profiles: readonly AgentProfile[] | null,
  t: ChiefTranslateFn,
): ChiefRoutingValidation {
  const softSec = parsePositiveInteger(draft.softWarningSecInput);
  const hardSec = parsePositiveInteger(draft.hardRecoverySecInput);

  let stallError: string | null = null;
  if (softSec === null) {
    stallError = t("settings.host.chief.errors.invalidSoftStall");
  } else if (hardSec === null) {
    stallError = t("settings.host.chief.errors.invalidHardStall");
  } else if (hardSec < softSec) {
    stallError = t("settings.host.chief.errors.hardBelowSoft", {
      soft: softSec,
      hard: hardSec,
    });
  }

  const roleErrors: Partial<Record<ChiefRoleKey, string>> = {};
  let verifierTierError: string | null = null;
  let verifierFallbackWarning: string | null = null;

  if (profiles !== null) {
    const profileIndex = buildProfileIndex(profiles);

    for (const role of CHIEF_ROLE_KEYS) {
      const entry = draft.roles[role];
      if (entry.primaryProfileId && !profileIndex.has(entry.primaryProfileId)) {
        roleErrors[role] = t("settings.host.chief.errors.unknownProfile", {
          id: entry.primaryProfileId,
        });
        continue;
      }
      const missingFallback = entry.fallbackProfileIds.find((id) => !profileIndex.has(id));
      if (missingFallback) {
        roleErrors[role] = t("settings.host.chief.errors.unknownProfile", {
          id: missingFallback,
        });
      }
    }

    const authorProfile = draft.roles.author.primaryProfileId
      ? profileIndex.get(draft.roles.author.primaryProfileId)
      : undefined;
    const verifierProfile = draft.roles.verifier.primaryProfileId
      ? profileIndex.get(draft.roles.verifier.primaryProfileId)
      : undefined;

    if (authorProfile && verifierProfile) {
      const authorTier = resolveAgentProfileTier(authorProfile);
      const verifierTier = resolveAgentProfileTier(verifierProfile);
      if (AGENT_PROFILE_TIER_RANKS[verifierTier] < AGENT_PROFILE_TIER_RANKS[authorTier]) {
        verifierTierError = t("settings.host.chief.errors.verifierTierBelowAuthor", {
          verifierName: verifierProfile.name,
          verifierTier: formatTierLabel(verifierTier, t),
          authorName: authorProfile.name,
          authorTier: formatTierLabel(authorTier, t),
        });
      }
    }

    if (authorProfile && draft.roles.verifier.fallbackProfileIds.length > 0) {
      const authorTier = resolveAgentProfileTier(authorProfile);
      const lowerFallbacks = draft.roles.verifier.fallbackProfileIds
        .map((id) => profileIndex.get(id))
        .filter((profile): profile is AgentProfile => {
          if (!profile) return false;
          const fbTier = resolveAgentProfileTier(profile);
          return AGENT_PROFILE_TIER_RANKS[fbTier] < AGENT_PROFILE_TIER_RANKS[authorTier];
        });
      if (lowerFallbacks.length > 0) {
        verifierFallbackWarning = t("settings.host.chief.errors.verifierFallbackBelowAuthor", {
          names: lowerFallbacks.map((profile) => profile.name).join(", "),
          authorTier: formatTierLabel(authorTier, t),
        });
      }
    }
  }

  const hasRoleErrors = Object.keys(roleErrors).length > 0;
  const isValid = stallError === null && verifierTierError === null && !hasRoleErrors;

  return {
    isValid,
    stallError,
    verifierTierError,
    verifierFallbackWarning,
    roleErrors,
  };
}

function toRolePatch(entry: ChiefRoleRoutingDraft): ChiefRoleRoutingEntry | null {
  const primary = entry.primaryProfileId.trim();
  if (!primary) {
    return null;
  }
  return {
    primaryProfileId: primary,
    fallbackProfileIds: entry.fallbackProfileIds,
  };
}

export function buildChiefConfigPatch(draft: ChiefRoutingDraft): ChiefConfigPatch | null {
  const softWarningSec = parsePositiveInteger(draft.softWarningSecInput);
  const hardRecoverySec = parsePositiveInteger(draft.hardRecoverySecInput);
  if (softWarningSec === null || hardRecoverySec === null || hardRecoverySec < softWarningSec) {
    return null;
  }
  return {
    defaultTier: draft.defaultTier,
    roles: {
      chief: toRolePatch(draft.roles.chief),
      author: toRolePatch(draft.roles.author),
      verifier: toRolePatch(draft.roles.verifier),
      integrator: toRolePatch(draft.roles.integrator),
    },
    stall: {
      softWarningSec,
      hardRecoverySec,
    },
    landing: {
      requireHumanApproval: draft.requireHumanApproval,
      mode: draft.landingMode,
      strategy: draft.landingStrategy,
    },
  };
}

function formatProfileOptionDescription(profile: AgentProfile, t: ChiefTranslateFn): string {
  const tier = resolveAgentProfileTier(profile);
  const tierLabel = formatTierLabel(tier, t);
  const parts = [profile.provider, profile.model?.trim(), tierLabel].filter(Boolean);
  return parts.join(" · ");
}

interface FallbackChipProps {
  role: ChiefRoleKey;
  fallbackId: string;
  label: string;
  name: string;
  disabled: boolean;
  onRemove: (role: ChiefRoleKey, profileId: string) => void;
}

function FallbackChip({
  role,
  fallbackId,
  label,
  name,
  disabled,
  onRemove,
}: FallbackChipProps): ReactElement {
  const { t } = useTranslation();
  const handleRemove = useCallback(() => {
    onRemove(role, fallbackId);
  }, [fallbackId, onRemove, role]);

  return (
    <Badge
      variant="secondary"
      className="gap-1 pr-1"
      data-testid={`chief-role-${role}-fallback-chip-${fallbackId}`}
    >
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={handleRemove}
        aria-label={t("settings.host.chief.roles.removeFallback", { name })}
        data-testid={`chief-role-${role}-fallback-remove-${fallbackId}`}
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

interface ChiefRoleRowProps {
  role: ChiefRoleKey;
  entry: ChiefRoleRoutingDraft;
  profiles: readonly AgentProfile[];
  profileIndex: Map<string, AgentProfile>;
  error: string | null;
  warning: string | null;
  disabled: boolean;
  onPrimaryChange: (role: ChiefRoleKey, profileId: string) => void;
  onAddFallback: (role: ChiefRoleKey, profileId: string) => void;
  onRemoveFallback: (role: ChiefRoleKey, profileId: string) => void;
}

function ChiefRoleRow({
  role,
  entry,
  profiles,
  profileIndex,
  error,
  warning,
  disabled,
  onPrimaryChange,
  onAddFallback,
  onRemoveFallback,
}: ChiefRoleRowProps): ReactElement {
  const { t } = useTranslation();

  const primaryOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: "__auto__",
        value: UNASSIGNED_PROFILE_VALUE,
        label: t("settings.host.chief.roles.unassigned"),
        description: t("settings.host.chief.roles.unassignedHint"),
        testID: `chief-role-${role}-primary-option-auto`,
      },
      ...profiles.map((profile) => ({
        id: profile.id,
        value: profile.id,
        label: profile.name,
        description: formatProfileOptionDescription(profile, t),
        testID: `chief-role-${role}-primary-option-${profile.id}`,
      })),
    ],
    [profiles, role, t],
  );

  const selectedPrimaryProfile = entry.primaryProfileId
    ? profileIndex.get(entry.primaryProfileId)
    : undefined;

  const selectedPrimaryDisplay = useMemo(() => {
    if (!entry.primaryProfileId) {
      return { label: t("settings.host.chief.roles.unassigned") };
    }
    if (selectedPrimaryProfile) {
      return {
        label: selectedPrimaryProfile.name,
        description: formatProfileOptionDescription(selectedPrimaryProfile, t),
      };
    }
    return { label: entry.primaryProfileId };
  }, [entry.primaryProfileId, selectedPrimaryProfile, t]);

  const fallbackCandidateOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const used = new Set<string>([entry.primaryProfileId, ...entry.fallbackProfileIds]);
    return profiles
      .filter((profile) => !used.has(profile.id))
      .map((profile) => ({
        id: profile.id,
        value: profile.id,
        label: profile.name,
        description: formatProfileOptionDescription(profile, t),
        testID: `chief-role-${role}-fallback-option-${profile.id}`,
      }));
  }, [entry.fallbackProfileIds, entry.primaryProfileId, profiles, role, t]);

  const handlePrimarySelect = useCallback(
    (value: string) => onPrimaryChange(role, value),
    [onPrimaryChange, role],
  );

  const handleFallbackSelect = useCallback(
    (value: string) => {
      if (value) {
        onAddFallback(role, value);
      }
    },
    [onAddFallback, role],
  );

  const roleLabel = t(`settings.host.chief.roles.${role}.label`);
  const roleHint = t(`settings.host.chief.roles.${role}.hint`);

  return (
    <Item
      variant="outline"
      className="flex-col items-stretch gap-3"
      data-testid={`chief-role-row-${role}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <ItemContent className="min-w-0">
          <ItemTitle>{roleLabel}</ItemTitle>
          <ItemDescription>{roleHint}</ItemDescription>
        </ItemContent>
        <div className="w-full shrink-0 sm:w-64">
          <SelectField<string>
            label={roleLabel}
            value={entry.primaryProfileId}
            selectedDisplay={selectedPrimaryDisplay}
            options={primaryOptions}
            onChange={handlePrimarySelect}
            placeholder={t("settings.host.chief.roles.unassigned")}
            emptyText={t("settings.host.chief.roles.noProfiles")}
            searchable={primaryOptions.length > 6}
            disabled={disabled}
            field={false}
            testID={`chief-role-${role}-primary-field`}
            triggerTestID={`chief-role-${role}-primary-trigger`}
          />
        </div>
      </div>

      {entry.primaryProfileId ? (
        <div className="flex flex-col gap-2 border-t pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settings.host.chief.roles.fallbacksLabel")}
            </span>
            {fallbackCandidateOptions.length > 0 ? (
              <div className="w-52">
                <SelectField<string>
                  label={t("settings.host.chief.roles.addFallback")}
                  value={null}
                  selectedDisplay={null}
                  options={fallbackCandidateOptions}
                  onChange={handleFallbackSelect}
                  placeholder={t("settings.host.chief.roles.addFallback")}
                  emptyText={t("settings.host.chief.roles.noMoreFallbacks")}
                  searchable={fallbackCandidateOptions.length > 6}
                  disabled={disabled}
                  field={false}
                  testID={`chief-role-${role}-fallback-field`}
                  triggerTestID={`chief-role-${role}-fallback-trigger`}
                />
              </div>
            ) : null}
          </div>

          {entry.fallbackProfileIds.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid={`chief-role-${role}-fallbacks`}
            >
              {entry.fallbackProfileIds.map((fallbackId) => {
                const fbProfile = profileIndex.get(fallbackId);
                const fbLabel = fbProfile
                  ? `${fbProfile.name} (${formatTierLabel(resolveAgentProfileTier(fbProfile), t)})`
                  : fallbackId;
                return (
                  <FallbackChip
                    key={fallbackId}
                    role={role}
                    fallbackId={fallbackId}
                    label={fbLabel}
                    name={fbProfile?.name ?? fallbackId}
                    disabled={disabled}
                    onRemove={onRemoveFallback}
                  />
                );
              })}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("settings.host.chief.roles.noFallbacksSelected")}
            </span>
          )}
        </div>
      ) : null}

      {warning ? (
        <ItemDescription className="text-status-warning" data-testid={`chief-role-${role}-warning`}>
          {warning}
        </ItemDescription>
      ) : null}

      {error ? (
        <ItemDescription
          role="alert"
          className="text-destructive"
          data-testid={`chief-role-${role}-error`}
        >
          {error}
        </ItemDescription>
      ) : null}
    </Item>
  );
}

export function ChiefRoutingSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const { profiles } = useAgentProfiles(serverId);

  const persistedDraft = useMemo(() => buildChiefRoutingDraft(config?.chief), [config?.chief]);
  const [draft, setDraft] = useState<ChiefRoutingDraft>(persistedDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(persistedDraft);
    setSaveError(null);
  }, [persistedDraft]);

  const hasChanges = useMemo(() => !equal(draft, persistedDraft), [draft, persistedDraft]);
  const validation = useMemo(
    () => validateChiefRoutingDraft(draft, profiles, t),
    [draft, profiles, t],
  );

  const profileList = profiles ?? EMPTY_PROFILES;
  const profileIndex = useMemo(() => buildProfileIndex(profileList), [profileList]);

  const handleDefaultTierChange = useCallback((value: string) => {
    const next = CHIEF_MISSION_TIERS.find((tier) => tier === value);
    if (!next) return;
    setSaveError(null);
    setDraft((prev) => ({ ...prev, defaultTier: next }));
  }, []);

  const handleRequireHumanApprovalChange = useCallback((checked: boolean) => {
    setSaveError(null);
    setDraft((prev) => ({ ...prev, requireHumanApproval: checked }));
  }, []);

  const handleLandingModeChange = useCallback((value: string) => {
    const next = SUPPORTED_LANDING_MODES.find((mode) => mode === value);
    if (!next) return;
    setSaveError(null);
    setDraft((prev) => ({ ...prev, landingMode: next }));
  }, []);

  const handleLandingStrategyChange = useCallback((value: string) => {
    const next = CHIEF_LANDING_STRATEGIES.find((strategy) => strategy === value);
    if (!next) return;
    setSaveError(null);
    setDraft((prev) => ({ ...prev, landingStrategy: next }));
  }, []);

  const handleSoftStallInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/[^\d]/g, "");
    setSaveError(null);
    setDraft((prev) => ({ ...prev, softWarningSecInput: digits }));
  }, []);

  const handleHardStallInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/[^\d]/g, "");
    setSaveError(null);
    setDraft((prev) => ({ ...prev, hardRecoverySecInput: digits }));
  }, []);

  const handlePrimaryRoleChange = useCallback((role: ChiefRoleKey, profileId: string) => {
    setSaveError(null);
    setDraft((prev) => {
      const trimmed = profileId.trim();
      const nextFallbacks = trimmed
        ? prev.roles[role].fallbackProfileIds.filter((id) => id !== trimmed)
        : [];
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            primaryProfileId: trimmed,
            fallbackProfileIds: nextFallbacks,
          },
        },
      };
    });
  }, []);

  const handleAddRoleFallback = useCallback((role: ChiefRoleKey, profileId: string) => {
    setSaveError(null);
    setDraft((prev) => {
      const current = prev.roles[role];
      if (
        !current.primaryProfileId ||
        current.primaryProfileId === profileId ||
        current.fallbackProfileIds.includes(profileId)
      ) {
        return prev;
      }
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            ...current,
            fallbackProfileIds: [...current.fallbackProfileIds, profileId],
          },
        },
      };
    });
  }, []);

  const handleRemoveRoleFallback = useCallback((role: ChiefRoleKey, profileId: string) => {
    setSaveError(null);
    setDraft((prev) => ({
      ...prev,
      roles: {
        ...prev.roles,
        [role]: {
          ...prev.roles[role],
          fallbackProfileIds: prev.roles[role].fallbackProfileIds.filter((id) => id !== profileId),
        },
      },
    }));
  }, []);

  const handleReset = useCallback(() => {
    setDraft(persistedDraft);
    setSaveError(null);
  }, [persistedDraft]);

  const handleSave = useCallback(async () => {
    if (!validation.isValid || isSaving) {
      return;
    }
    const chiefPatch = buildChiefConfigPatch(draft);
    if (!chiefPatch) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await patchConfig({ chief: chiefPatch });
    } catch (error) {
      setSaveError(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, patchConfig, validation.isValid]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  if (!isConnected) {
    return null;
  }

  if (isLoading || !config) {
    return (
      <SettingsSection
        title={t("settings.host.chief.sectionTitle")}
        info={t("settings.host.chief.sectionHint")}
        testID="chief-routing-section"
      >
        <ItemGroup>
          <div className="flex min-h-[120px] items-center justify-center text-muted-foreground">
            <Spinner className="size-6" />
          </div>
        </ItemGroup>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t("settings.host.chief.sectionTitle")}
      info={t("settings.host.chief.sectionHint")}
      testID="chief-routing-section"
    >
      <ItemGroup data-testid="chief-routing-policy-card">
        <Item variant="outline" className="flex-wrap justify-between gap-3">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.defaultTier.label")}</ItemTitle>
            <ItemDescription>
              {t(`settings.host.chief.defaultTier.descriptions.${draft.defaultTier}`)}
            </ItemDescription>
          </ItemContent>
          <Tabs
            value={draft.defaultTier}
            onValueChange={handleDefaultTierChange}
            data-testid="chief-default-tier-tabs"
          >
            <TabsList>
              {CHIEF_MISSION_TIERS.map((tier) => (
                <TabsTrigger
                  key={tier}
                  value={tier}
                  disabled={isSaving}
                  data-testid={`chief-default-tier-${tier}`}
                >
                  {t(`settings.host.chief.defaultTier.options.${tier}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Item>

        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.landing.requireApprovalTitle")}</ItemTitle>
            <ItemDescription>
              {t("settings.host.chief.landing.requireApprovalHint")}
            </ItemDescription>
          </ItemContent>
          <Switch
            checked={draft.requireHumanApproval}
            onCheckedChange={handleRequireHumanApprovalChange}
            disabled={isSaving}
            aria-label={t("settings.host.chief.landing.requireApprovalTitle")}
            data-testid="chief-landing-require-approval-switch"
          />
        </Item>

        <Item variant="outline" className="flex-wrap justify-between gap-3">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.landing.modeTitle")}</ItemTitle>
            <ItemDescription>
              {t(`settings.host.chief.landing.modeDescriptions.${draft.landingMode}`)}
            </ItemDescription>
          </ItemContent>
          <Tabs
            value={draft.landingMode}
            onValueChange={handleLandingModeChange}
            data-testid="chief-landing-mode-tabs"
          >
            <TabsList>
              {SUPPORTED_LANDING_MODES.map((mode) => (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  disabled={isSaving}
                  data-testid={`chief-landing-mode-${mode}`}
                >
                  {t(`settings.host.chief.landing.modeOptions.${mode}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Item>

        <Item variant="outline" className="flex-wrap justify-between gap-3">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.landing.strategyTitle")}</ItemTitle>
            <ItemDescription>
              {t(`settings.host.chief.landing.strategyDescriptions.${draft.landingStrategy}`)}
            </ItemDescription>
          </ItemContent>
          <Tabs
            value={draft.landingStrategy}
            onValueChange={handleLandingStrategyChange}
            data-testid="chief-landing-strategy-tabs"
          >
            <TabsList>
              {CHIEF_LANDING_STRATEGIES.map((strategy) => (
                <TabsTrigger
                  key={strategy}
                  value={strategy}
                  disabled={isSaving}
                  data-testid={`chief-landing-strategy-${strategy}`}
                >
                  {t(`settings.host.chief.landing.strategyOptions.${strategy}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Item>
      </ItemGroup>

      <ItemGroup data-testid="chief-routing-stall-card">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.stall.softWarningTitle")}</ItemTitle>
            <ItemDescription>{t("settings.host.chief.stall.softWarningHint")}</ItemDescription>
          </ItemContent>
          <Input
            value={draft.softWarningSecInput}
            onChange={handleSoftStallInput}
            inputMode="numeric"
            disabled={isSaving}
            className="w-24 text-right"
            aria-label={t("settings.host.chief.stall.softWarningTitle")}
            data-testid="chief-stall-soft-input"
          />
        </Item>

        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.chief.stall.hardRecoveryTitle")}</ItemTitle>
            <ItemDescription>{t("settings.host.chief.stall.hardRecoveryHint")}</ItemDescription>
            {validation.stallError ? (
              <ItemDescription
                role="alert"
                className="text-destructive"
                data-testid="chief-routing-stall-error"
              >
                {validation.stallError}
              </ItemDescription>
            ) : null}
          </ItemContent>
          <Input
            value={draft.hardRecoverySecInput}
            onChange={handleHardStallInput}
            inputMode="numeric"
            disabled={isSaving}
            className="w-24 text-right"
            aria-label={t("settings.host.chief.stall.hardRecoveryTitle")}
            data-testid="chief-stall-hard-input"
          />
        </Item>
      </ItemGroup>

      <ItemGroup data-testid="chief-routing-roles-card">
        {CHIEF_ROLE_KEYS.map((role) => {
          const roleError =
            role === "verifier"
              ? (validation.verifierTierError ?? validation.roleErrors[role] ?? null)
              : (validation.roleErrors[role] ?? null);
          const roleWarning = role === "verifier" ? validation.verifierFallbackWarning : null;
          return (
            <ChiefRoleRow
              key={role}
              role={role}
              entry={draft.roles[role]}
              profiles={profileList}
              profileIndex={profileIndex}
              error={roleError}
              warning={roleWarning}
              disabled={isSaving}
              onPrimaryChange={handlePrimaryRoleChange}
              onAddFallback={handleAddRoleFallback}
              onRemoveFallback={handleRemoveRoleFallback}
            />
          );
        })}
      </ItemGroup>

      {validation.verifierTierError ? (
        <Alert variant="destructive" data-testid="chief-routing-verifier-tier-error">
          <CircleAlert />
          <AlertTitle>{t("settings.host.chief.errors.verifierTierTitle")}</AlertTitle>
          <AlertDescription>{validation.verifierTierError}</AlertDescription>
        </Alert>
      ) : null}

      {saveError ? (
        <Alert variant="destructive" data-testid="chief-routing-save-error">
          <CircleAlert />
          <AlertTitle>{t("settings.host.chief.errors.saveTitle")}</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={!hasChanges || isSaving}
          data-testid="chief-routing-reset"
        >
          {t("settings.host.chief.actions.reset")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSavePress}
          disabled={!hasChanges || !validation.isValid || isSaving}
          data-testid="chief-routing-save"
        >
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          {isSaving
            ? t("settings.host.chief.actions.saving")
            : t("settings.host.chief.actions.save")}
        </Button>
      </div>
    </SettingsSection>
  );
}
