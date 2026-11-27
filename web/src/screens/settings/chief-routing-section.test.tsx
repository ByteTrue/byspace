/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProfile,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
} from "@bytetrue/protocol/messages";

const { configState, profilesState, patchConfigMock } = vi.hoisted(() => ({
  configState: {
    config: null as MutableDaemonConfig | null,
    isLoading: false,
  },
  profilesState: {
    profiles: [] as AgentProfile[],
  },
  patchConfigMock: vi.fn(
    async (_patch: MutableDaemonConfigPatch): Promise<MutableDaemonConfig | undefined> => undefined,
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const table: Record<string, string> = {
        "settings.host.chief.sectionTitle": "Chief routing",
        "settings.host.chief.sectionHint": "Defaults for orchestrated missions.",
        "settings.host.chief.defaultTier.label": "Default tier",
        "settings.host.chief.defaultTier.options.L0": "L0 Solo",
        "settings.host.chief.defaultTier.options.L1": "L1 Verify",
        "settings.host.chief.defaultTier.options.L2": "L2 Chief",
        "settings.host.chief.defaultTier.descriptions.L0": "Direct solo agent.",
        "settings.host.chief.defaultTier.descriptions.L1": "Solo author with shadow verifier.",
        "settings.host.chief.defaultTier.descriptions.L2": "Multi-worktree orchestration.",
        "settings.host.chief.landing.requireApprovalTitle": "Require approval before landing",
        "settings.host.chief.landing.requireApprovalHint": "Ask before landing changes.",
        "settings.host.chief.landing.modeTitle": "Landing mode",
        "settings.host.chief.landing.modeOptions.merge_local": "Merge local",
        "settings.host.chief.landing.modeOptions.open_pr": "Open PR",
        "settings.host.chief.landing.modeDescriptions.merge_local": "Land into target branch.",
        "settings.host.chief.landing.modeDescriptions.open_pr": "Open pull request.",
        "settings.host.chief.landing.strategyTitle": "Merge strategy",
        "settings.host.chief.landing.strategyOptions.squash": "Squash",
        "settings.host.chief.landing.strategyOptions.merge": "Merge",
        "settings.host.chief.landing.strategyOptions.rebase": "Rebase",
        "settings.host.chief.landing.strategyDescriptions.squash": "Squash commits.",
        "settings.host.chief.landing.strategyDescriptions.merge": "Create merge commit.",
        "settings.host.chief.landing.strategyDescriptions.rebase": "Rebase then fast-forward.",
        "settings.host.chief.stall.softWarningTitle": "Soft warning (seconds)",
        "settings.host.chief.stall.softWarningHint": "Warn when idle.",
        "settings.host.chief.stall.hardRecoveryTitle": "Hard recovery (seconds)",
        "settings.host.chief.stall.hardRecoveryHint": "Recover when stalled.",
        "settings.host.chief.roles.unassigned": "Automatic",
        "settings.host.chief.roles.unassignedHint": "Use default host routing.",
        "settings.host.chief.roles.noProfiles": "No profiles configured",
        "settings.host.chief.roles.fallbacksLabel": "Fallback profiles",
        "settings.host.chief.roles.addFallback": "Add fallback",
        "settings.host.chief.roles.noMoreFallbacks": "No other profiles available",
        "settings.host.chief.roles.noFallbacksSelected": "No fallbacks selected",
        "settings.host.chief.roles.removeFallback": "Remove {{name}}",
        "settings.host.chief.roles.chief.label": "Chief",
        "settings.host.chief.roles.chief.hint": "Mission coordinator.",
        "settings.host.chief.roles.author.label": "Author",
        "settings.host.chief.roles.author.hint": "Writes implementation.",
        "settings.host.chief.roles.verifier.label": "Verifier",
        "settings.host.chief.roles.verifier.hint": "Read-only reviewer.",
        "settings.host.chief.roles.integrator.label": "Integrator",
        "settings.host.chief.roles.integrator.hint": "Resolves conflicts.",
        "settings.host.chief.actions.save": "Save",
        "settings.host.chief.actions.saving": "Saving...",
        "settings.host.chief.actions.reset": "Reset",
        "settings.host.chief.errors.verifierTierTitle": "Verifier tier too low",
        "settings.host.chief.errors.saveTitle": "Unable to save Chief routing",
        "settings.host.chief.errors.invalidSoftStall": "Soft warning must be a positive integer.",
        "settings.host.chief.errors.invalidHardStall": "Hard recovery must be a positive integer.",
        "settings.host.chief.errors.hardBelowSoft":
          "Hard recovery ({{hard}}s) must be at least soft warning ({{soft}}s).",
        "settings.host.chief.errors.unknownProfile": "Unknown profile {{id}}.",
        "settings.host.chief.errors.verifierTierBelowAuthor":
          "Verifier {{verifierName}} ({{verifierTier}}) must be >= Author {{authorName}} ({{authorTier}}).",
        "settings.host.chief.errors.verifierFallbackBelowAuthor":
          "Fallback {{names}} is below author tier {{authorTier}}.",
        "settings.host.agentProfiles.tiers.fast": "Fast",
        "settings.host.agentProfiles.tiers.standard": "Standard",
        "settings.host.agentProfiles.tiers.strong": "Strong",
      };
      let text = table[key] ?? key;
      for (const [k, v] of Object.entries(values ?? {})) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
      return text;
    },
  }),
}));

vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({
    title,
    children,
    testID,
  }: {
    title: string;
    children: React.ReactNode;
    testID?: string;
  }) => (
    <section data-testid={testID}>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    isLoading: configState.isLoading,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/agent-profiles/internal/use-agent-profiles", () => ({
  useAgentProfiles: () => ({
    profiles: profilesState.profiles,
    saveProfiles: vi.fn(),
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/widgets/select-field", () => ({
  SelectField: ({
    label,
    value,
    options,
    onChange,
    disabled,
    triggerTestID,
  }: {
    label: string;
    value: string | null;
    options: Array<{ id: string; value: string; label: string }>;
    onChange: (value: string, display: { label: string }) => void;
    disabled?: boolean;
    triggerTestID?: string;
  }) => (
    <select
      aria-label={label}
      data-testid={triggerTestID}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => {
        const nextValue = event.target.value;
        const found = options.find((opt) => opt.value === nextValue);
        onChange(nextValue, { label: found?.label ?? nextValue });
      }}
    >
      {value === null ? <option value="">Select...</option> : null}
      {options.map((opt) => (
        <option key={opt.id} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

import {
  ChiefRoutingSection,
  buildChiefRoutingDraft,
  validateChiefRoutingDraft,
} from "./chief-routing-section";

const FAST_PROFILE: AgentProfile = {
  id: "prof-fast",
  name: "Fast Haiku",
  provider: "claude",
  model: "claude-haiku-4-5",
  tier: "fast",
};

const STANDARD_PROFILE: AgentProfile = {
  id: "prof-standard",
  name: "Standard Sonnet",
  provider: "claude",
  model: "claude-sonnet-4-6",
  tier: "standard",
};

const STRONG_PROFILE: AgentProfile = {
  id: "prof-strong",
  name: "Strong Opus",
  provider: "claude",
  model: "claude-opus-4-7",
  tier: "strong",
};

function makeConfig(chief?: MutableDaemonConfig["chief"]): MutableDaemonConfig {
  return {
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    appendSystemPrompt: "",
    agentProfiles: profilesState.profiles,
    ...(chief ? { chief } : {}),
  };
}

function setSelectValue(container: HTMLElement, testId: string, value: string): void {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  if (!select) {
    throw new Error(`Missing select [data-testid="${testId}"]`);
  }
  const setVal = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setVal?.call(select, value);
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function setInputValue(container: HTMLElement, testId: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (!input) {
    throw new Error(`Missing input [data-testid="${testId}"]`);
  }
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setVal?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

describe("ChiefRoutingSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    profilesState.profiles = [FAST_PROFILE, STANDARD_PROFILE, STRONG_PROFILE];
    configState.config = makeConfig();
    configState.isLoading = false;
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(makeConfig());
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function renderSection(): HTMLElement {
    act(() => {
      root?.render(<ChiefRoutingSection serverId="srv-1" />);
    });
    if (!container) throw new Error("Missing container");
    return container;
  }

  it("seeds confirmed user defaults when daemon.chief is omitted", () => {
    const el = renderSection();

    const soft = el.querySelector<HTMLInputElement>('[data-testid="chief-stall-soft-input"]');
    const hard = el.querySelector<HTMLInputElement>('[data-testid="chief-stall-hard-input"]');
    const approval = el.querySelector<HTMLElement>(
      '[data-testid="chief-landing-require-approval-switch"]',
    );
    const save = el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]');

    expect(soft?.value).toBe("600");
    expect(hard?.value).toBe("1200");
    expect(approval?.getAttribute("aria-checked")).toBe("true");
    expect(
      el
        .querySelector('[data-testid="chief-landing-mode-merge_local"]')
        ?.getAttribute("data-state") ??
        el
          .querySelector('[data-testid="chief-landing-mode-merge_local"]')
          ?.getAttribute("aria-selected"),
    ).toBeTruthy();
    expect(save?.disabled).toBe(true);
  });

  it("does not offer or save the unsupported open_pr landing mode", async () => {
    configState.config = makeConfig({
      landing: {
        requireHumanApproval: true,
        mode: "open_pr",
        strategy: "squash",
      },
    });
    const el = renderSection();

    expect(el.querySelector('[data-testid="chief-landing-mode-open_pr"]')).toBeNull();

    setInputValue(el, "chief-stall-soft-input", "601");
    const save = el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]');
    await act(async () => {
      save?.click();
    });

    expect(patchConfigMock).toHaveBeenCalledWith({
      chief: expect.objectContaining({
        landing: {
          requireHumanApproval: true,
          mode: "merge_local",
          strategy: "squash",
        },
      }),
    });
  });

  it("blocks save with a clear error when Verifier.tier < Author.tier and clears when fixed", async () => {
    const el = renderSection();

    setSelectValue(el, "chief-role-author-primary-trigger", STRONG_PROFILE.id);
    setSelectValue(el, "chief-role-verifier-primary-trigger", STANDARD_PROFILE.id);

    const errorBanner = el.querySelector('[data-testid="chief-routing-verifier-tier-error"]');
    const save = el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]');
    expect(errorBanner).not.toBeNull();
    expect(errorBanner?.textContent).toContain("Standard Sonnet (Standard)");
    expect(errorBanner?.textContent).toContain("Strong Opus (Strong)");
    expect(save?.disabled).toBe(true);
    expect(patchConfigMock).not.toHaveBeenCalled();

    setSelectValue(el, "chief-role-verifier-primary-trigger", STRONG_PROFILE.id);
    expect(el.querySelector('[data-testid="chief-routing-verifier-tier-error"]')).toBeNull();
    expect(save?.disabled).toBe(false);

    await act(async () => {
      save?.click();
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      chief: {
        defaultTier: "L1",
        roles: {
          chief: null,
          author: { primaryProfileId: "prof-strong", fallbackProfileIds: [] },
          verifier: { primaryProfileId: "prof-strong", fallbackProfileIds: [] },
          integrator: null,
        },
        stall: { softWarningSec: 600, hardRecoverySec: 1200 },
        landing: {
          requireHumanApproval: true,
          mode: "merge_local",
          strategy: "squash",
        },
      },
    });
  });

  it("validates stall thresholds and saves fallback profiles + landing policy", async () => {
    const el = renderSection();

    setInputValue(el, "chief-stall-hard-input", "300");
    expect(el.querySelector('[data-testid="chief-routing-stall-error"]')).not.toBeNull();
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]')?.disabled,
    ).toBe(true);

    setInputValue(el, "chief-stall-hard-input", "900");
    expect(el.querySelector('[data-testid="chief-routing-stall-error"]')).toBeNull();

    setSelectValue(el, "chief-role-author-primary-trigger", STANDARD_PROFILE.id);
    setSelectValue(el, "chief-role-author-fallback-trigger", FAST_PROFILE.id);
    setSelectValue(el, "chief-role-verifier-primary-trigger", STRONG_PROFILE.id);

    const approvalSwitch = el.querySelector<HTMLElement>(
      '[data-testid="chief-landing-require-approval-switch"]',
    );
    act(() => {
      approvalSwitch?.click();
    });

    const save = el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]');
    await act(async () => {
      save?.click();
    });

    expect(patchConfigMock).toHaveBeenCalledWith({
      chief: {
        defaultTier: "L1",
        roles: {
          chief: null,
          author: { primaryProfileId: "prof-standard", fallbackProfileIds: ["prof-fast"] },
          verifier: { primaryProfileId: "prof-strong", fallbackProfileIds: [] },
          integrator: null,
        },
        stall: { softWarningSec: 600, hardRecoverySec: 900 },
        landing: {
          requireHumanApproval: false,
          mode: "merge_local",
          strategy: "squash",
        },
      },
    });
  });

  it("surfaces server error when patchConfig rejects", async () => {
    patchConfigMock.mockRejectedValueOnce(new Error("chief.roles.verifier rejected by daemon"));
    const el = renderSection();

    setSelectValue(el, "chief-role-author-primary-trigger", STANDARD_PROFILE.id);
    setSelectValue(el, "chief-role-verifier-primary-trigger", STRONG_PROFILE.id);

    const save = el.querySelector<HTMLButtonElement>('[data-testid="chief-routing-save"]');
    await act(async () => {
      save?.click();
    });

    const saveErr = el.querySelector('[data-testid="chief-routing-save-error"]');
    expect(saveErr?.textContent).toContain("chief.roles.verifier rejected by daemon");
  });

  it("treats omitted profile tier as standard during Verifier >= Author check", () => {
    const untiered: AgentProfile = { id: "prof-omitted", name: "Untiered", provider: "codex" };
    const draft = buildChiefRoutingDraft({
      roles: {
        author: { primaryProfileId: "prof-omitted" },
        verifier: { primaryProfileId: "prof-fast" },
      },
    });
    const result = validateChiefRoutingDraft(draft, [untiered, FAST_PROFILE], (k) => k);
    expect(result.isValid).toBe(false);
    expect(result.verifierTierError).toBe("settings.host.chief.errors.verifierTierBelowAuthor");
  });
});
