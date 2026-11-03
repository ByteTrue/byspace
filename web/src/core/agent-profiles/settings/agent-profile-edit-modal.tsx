// Port of archive/expo-app:packages/app/src/agent-profiles/settings/agent-profile-edit-modal.tsx: same form
// model and open/close lifecycle, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agent-profile-edit-modal.py; edit it directly.
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "~/components/ui/item";
import { useRetainedOpenProps } from "~/hooks/use-retained-open-props";
import { useCallback, useMemo, type ReactElement, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { AgentFeature } from "@bytetrue/protocol/agent-types";
import type { AgentProfile } from "@bytetrue/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "~/components/ui/switch";
import { toErrorMessage } from "@/utils/error-messages";
import { AgentProfileAppearanceField } from "@/agent-profiles/settings/agent-profile-appearance-field";
import type {
  AgentProfileFormModel,
  AgentProfileFormOption,
  AgentProfileSeed,
  AgentProfileValue,
} from "@/agent-profiles/internal/profile-form-model";
import {
  useAgentProfileFormCatalog,
  useAgentProfileFormFeatures,
} from "@/agent-profiles/internal/use-profile-form-inputs";
import {
  useAgentProfileFormModel,
  useAgentProfileFormState,
} from "@/agent-profiles/internal/use-profile-form-model";
import { Input } from "~/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";

export interface AgentProfileEditModalProps {
  serverId: string;
  visible: boolean;
  mode: "create" | "edit";
  profile?: AgentProfile;
  seed?: AgentProfileSeed;
  onClose: () => void;
  onSave: (value: AgentProfileValue) => Promise<void>;
}

/**
 * Only reachable before the catalog lands. Every select is seeded to a concrete
 * id as soon as one exists, and none of them offer an "unset" row.
 */
const UNSET_VALUE = "";

function openKey(props: AgentProfileEditModalProps): string {
  if (props.mode === "edit") {
    return `edit:${props.profile?.id ?? ""}`;
  }
  return `create:${props.seed?.provider ?? ""}:${props.seed?.modelId ?? ""}`;
}

/**
 * Create and edit never share a mounted instance: the body is keyed on mode plus
 * profile id, so every open constructs a form model seeded from that record.
 */
export function AgentProfileEditModal(props: AgentProfileEditModalProps): ReactElement | null {
  const { retained, generation, release } = useRetainedOpenProps(props);
  if (!retained) {
    return null;
  }
  return (
    <OpenAgentProfileEditModal
      key={`${openKey(retained)}:${generation}`}
      {...retained}
      visible={props.visible}
      onClose={props.onClose}
      onDismiss={release}
    />
  );
}

function toSelectOptions(options: AgentProfileFormOption[]): SelectFieldOption<string>[] {
  return options.map((option) => ({
    id: option.id,
    value: option.value,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
    testID: option.testID,
  }));
}

function OpenAgentProfileEditModal({
  serverId,
  visible,
  mode,
  profile,
  seed,
  onClose,
  onDismiss,
  onSave,
}: AgentProfileEditModalProps & { onDismiss: () => void }): ReactElement {
  const { t } = useTranslation();
  const snapshot = useMemo(
    () => ({ mode, ...(profile ? { profile } : {}), ...(seed ? { seed } : {}) }),
    [mode, profile, seed],
  );
  const model = useAgentProfileFormModel(snapshot);
  const handleNotesInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => model.setNotes(event.target.value),
    [model],
  );
  const handleNameInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => model.setName(event.target.value),
    [model],
  );
  const state = useAgentProfileFormState(model);
  useAgentProfileFormCatalog({ serverId, model });
  useAgentProfileFormFeatures({ serverId, model, state });

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title:
        mode === "edit"
          ? t("settings.host.agentProfiles.editProfileTitle")
          : t("settings.host.agentProfiles.addProfileTitle"),
    }),
    [mode, t],
  );

  const providerOptions = useMemo(
    () => toSelectOptions(state.providerOptions),
    [state.providerOptions],
  );
  const modelOptions = useMemo(() => toSelectOptions(state.modelOptions), [state.modelOptions]);
  const modeOptions = useMemo(() => toSelectOptions(state.modeOptions), [state.modeOptions]);
  const thinkingOptions = useMemo(
    () => toSelectOptions(state.thinkingOptions),
    [state.thinkingOptions],
  );

  const handleAppearanceChange = useCallback(
    (value: { icon: string; color: string }) => model.setAppearance(value),
    [model],
  );
  const handleProviderChange = useCallback(
    (value: string, display: SelectFieldDisplay) => model.setProvider(value, display),
    [model],
  );
  const handleModelChange = useCallback(
    (value: string, display: SelectFieldDisplay) => model.setModel(value, value ? display : null),
    [model],
  );
  const handleModeChange = useCallback(
    (value: string, display: SelectFieldDisplay) => model.setMode(value, value ? display : null),
    [model],
  );
  const handleThinkingChange = useCallback(
    (value: string, display: SelectFieldDisplay) =>
      model.setThinking(value, value ? display : null),
    [model],
  );

  const handleSave = useCallback(async () => {
    const value = model.getState().submitValue;
    if (!value) {
      return;
    }
    model.setSubmitError(null);
    model.setSubmitting(true);
    try {
      await onSave(value);
      onClose();
    } catch (error) {
      model.setSubmitError(toErrorMessage(error));
    } finally {
      model.setSubmitting(false);
    }
  }, [model, onClose, onSave]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleCancel = useCallback(() => {
    if (state.isSubmitting) {
      return;
    }
    onClose();
  }, [onClose, state.isSubmitting]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={handleCancel}
      onDismiss={onDismiss}
      desktopMaxWidth={520}
      testID="agent-profile-edit-modal"
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-start gap-2">
          <div className="shrink-0">
            <AgentProfileAppearanceField
              label={t("settings.host.agentProfiles.iconLabel")}
              icon={state.icon}
              color={state.color}
              onChange={handleAppearanceChange}
              disabled={state.isSubmitting}
              testID="agent-profile-icon-field"
              triggerTestID="agent-profile-icon-trigger"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Field data-testid="agent-profile-name-field">
              <FieldLabel>{t("settings.host.agentProfiles.nameLabel")}</FieldLabel>
              <Input
                defaultValue={seed?.name ?? profile?.name ?? ""}
                onChange={handleNameInput}
                placeholder={t("settings.host.agentProfiles.namePlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                readOnly={state.isSubmitting}
                aria-label={t("settings.host.agentProfiles.nameLabel")}
                data-testid="agent-profile-name-input"
              />
            </Field>
          </div>
        </div>

        <SelectField
          label={t("settings.host.agentProfiles.providerLabel")}
          value={state.provider || null}
          selectedDisplay={state.providerDisplay}
          options={providerOptions}
          onChange={handleProviderChange}
          placeholder={t("settings.host.agentProfiles.providerPlaceholder")}
          emptyText={t("settings.host.agentProfiles.noProviders")}
          loading={state.catalogResolution !== "complete"}
          disabled={state.isSubmitting}
          searchable={providerOptions.length > 6}
          title={t("settings.host.agentProfiles.providerLabel")}
          testID="agent-profile-provider-field"
          triggerTestID="agent-profile-provider-trigger"
        />

        {state.disclosure.showModelField ? (
          <SelectField
            label={t("settings.host.agentProfiles.modelLabel")}
            value={state.modelId || UNSET_VALUE}
            selectedDisplay={state.modelDisplay}
            options={modelOptions}
            onChange={handleModelChange}
            placeholder={t("settings.host.agentProfiles.modelLabel")}
            emptyText={t("settings.host.agentProfiles.noModels")}
            disabled={state.isSubmitting}
            searchable={modelOptions.length > 6}
            title={t("settings.host.agentProfiles.modelLabel")}
            testID="agent-profile-model-field"
            triggerTestID="agent-profile-model-trigger"
          />
        ) : null}

        {state.disclosure.showModeField ? (
          <SelectField
            label={t("settings.host.agentProfiles.modeLabel")}
            value={state.modeId || UNSET_VALUE}
            selectedDisplay={state.modeDisplay}
            options={modeOptions}
            onChange={handleModeChange}
            placeholder={t("settings.host.agentProfiles.modeLabel")}
            emptyText={t("settings.host.agentProfiles.noModes")}
            disabled={state.isSubmitting}
            searchable={modeOptions.length > 6}
            title={t("settings.host.agentProfiles.modeLabel")}
            testID="agent-profile-mode-field"
            triggerTestID="agent-profile-mode-trigger"
          />
        ) : null}

        {state.disclosure.showThinkingField ? (
          <SelectField
            label={t("settings.host.agentProfiles.thinkingLabel")}
            value={state.thinkingOptionId || UNSET_VALUE}
            selectedDisplay={state.thinkingDisplay}
            options={thinkingOptions}
            onChange={handleThinkingChange}
            placeholder={t("settings.host.agentProfiles.thinkingLabel")}
            emptyText={t("settings.host.agentProfiles.noThinkingOptions")}
            disabled={state.isSubmitting}
            searchable={thinkingOptions.length > 6}
            title={t("settings.host.agentProfiles.thinkingLabel")}
            testID="agent-profile-thinking-field"
            triggerTestID="agent-profile-thinking-trigger"
          />
        ) : null}

        {state.disclosure.showFeaturesField ? (
          <Field data-testid="agent-profile-features-field">
            <FieldLabel>{t("settings.host.agentProfiles.featuresLabel")}</FieldLabel>
            <ItemGroup data-testid="agent-profile-features-card">
              {state.features.map((feature) => (
                <AgentProfileFeatureRow
                  key={feature.id}
                  feature={feature}
                  disabled={state.isSubmitting}
                  model={model}
                />
              ))}
            </ItemGroup>
          </Field>
        ) : null}

        <Field data-testid="agent-profile-notes-field">
          <FieldLabel>{t("settings.host.agentProfiles.notesLabel")}</FieldLabel>
          <Textarea
            defaultValue={profile?.notes ?? ""}
            onChange={handleNotesInput}
            placeholder={t("settings.host.agentProfiles.notesPlaceholder")}
            rows={4}
            readOnly={state.isSubmitting}
            aria-label={t("settings.host.agentProfiles.notesLabel")}
            data-testid="agent-profile-notes-input"
          />
          <FieldDescription data-testid="agent-profile-notes-field-hint">
            {t("settings.host.agentProfiles.notesHint")}
          </FieldDescription>
        </Field>

        {state.submitError ? (
          <span className="text-sm text-status-danger" data-testid="agent-profile-submit-error">
            {state.submitError}
          </span>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={handleCancel}
            data-testid="agent-profile-cancel-button"
            disabled={state.isSubmitting}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onClick={handleSavePress}
            data-testid="agent-profile-save-button"
            disabled={!state.canSubmit}
          >
            {state.isSubmitting
              ? t("settings.host.agentProfiles.saving")
              : t("settings.host.agentProfiles.save")}
          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>
  );
}

function AgentProfileFeatureRow({
  feature,
  disabled,
  model,
}: {
  feature: AgentFeature;
  disabled: boolean;
  model: AgentProfileFormModel;
}): ReactElement {
  const handleToggle = useCallback(
    (value: boolean) => model.setFeatureValue(feature.id, value),
    [feature.id, model],
  );
  const handleSelect = useCallback(
    (value: string) => model.setFeatureValue(feature.id, value),
    [feature.id, model],
  );
  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      feature.type === "select"
        ? feature.options.map((option) => ({
            id: option.id,
            value: option.id,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
            testID: `agent-profile-feature-option-${feature.id}-${option.id}`,
          }))
        : [],
    [feature],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    if (feature.type !== "select" || !feature.value) {
      return null;
    }
    const option = feature.options.find((candidate) => candidate.id === feature.value);
    return { label: option?.label ?? feature.value };
  }, [feature]);

  if (feature.type === "select") {
    return (
      <Item variant="outline" size="sm" data-testid={`agent-profile-feature-row-${feature.id}`}>
        <SelectField
          label={feature.label}
          value={feature.value}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={handleSelect}
          placeholder={feature.label}
          emptyText={feature.label}
          disabled={disabled}
          {...(feature.description ? { hint: feature.description } : {})}
          title={feature.label}
          testID={`agent-profile-feature-field-${feature.id}`}
          triggerTestID={`agent-profile-feature-trigger-${feature.id}`}
        />
      </Item>
    );
  }

  return (
    <Item variant="outline" size="sm" data-testid={`agent-profile-feature-row-${feature.id}`}>
      <ItemContent className="min-w-0">
        <ItemTitle>{feature.label}</ItemTitle>
        {feature.description ? <ItemDescription>{feature.description}</ItemDescription> : null}
      </ItemContent>
      <Switch
        checked={feature.value === true}
        onCheckedChange={handleToggle}
        disabled={disabled}
        aria-label={feature.label}
        data-testid={`agent-profile-feature-switch-${feature.id}`}
      />
    </Item>
  );
}
