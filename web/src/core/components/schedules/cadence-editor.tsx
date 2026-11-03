// Port of archive/expo-app:packages/app/src/components/schedules/cadence-editor.tsx: the cadence field of the schedule form; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/schedules.py; edit it directly.
import { useCallback, useMemo, useReducer, useState, type ReactNode } from "react";
import type { ScheduleCadence } from "@bytetrue/protocol/schedule/types";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import {
  CADENCE_PRESET_OPTIONS,
  normalizeScheduleFormCadence,
  resolveCronPresetDisplay,
  resolveCronPresetId,
} from "@/schedules/schedule-cadence-options";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import { describeCron, validateCron } from "@/utils/schedule-format";

type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;

export interface CadenceEditorProps {
  value: ScheduleCadence;
  onChange: (next: ScheduleCadence) => void;
  error?: string;
  size?: FieldControlSize;
}

const PRESET_OPTIONS: SelectFieldOption<string>[] = CADENCE_PRESET_OPTIONS.map((option) => ({
  id: option.id,
  value: option.id,
  label: option.label,
  testID: `schedule-cadence-preset-${option.id}`,
}));

function getCronPreview(expression: string, timezone: string, error: string | null): string | null {
  if (error || !expression) {
    return null;
  }
  return describeCron({ type: "cron", expression, timezone }) ?? expression;
}

function buildCronCadence(expression: string, timezone: string): CronCadence {
  return { type: "cron", expression, timezone };
}

export function CadenceEditor({ value, onChange, error, size = "md" }: CadenceEditorProps) {
  const deviceTimeZone = useMemo(getDeviceTimeZone, []);
  const normalizedValue = normalizeScheduleFormCadence(value, deviceTimeZone);
  const [cronText, setCronText] = useState(() => normalizedValue.expression);
  const [fieldResetKey, bumpFieldResetKey] = useReducer((key: number) => key + 1, 0);
  const cronTimeZone = normalizedValue.timezone ?? deviceTimeZone;
  const trimmedCron = cronText.trim();
  const localCronError = trimmedCron ? validateCron(trimmedCron) : null;
  const effectiveError = error ?? localCronError;
  const preview = getCronPreview(trimmedCron, cronTimeZone, effectiveError ?? null);
  const currentCadence = useMemo<CronCadence>(
    () => buildCronCadence(trimmedCron, cronTimeZone),
    [cronTimeZone, trimmedCron],
  );
  const selectedPresetId = resolveCronPresetId(currentCadence);
  const selectedPresetDisplay = resolveCronPresetDisplay(currentCadence);

  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = CADENCE_PRESET_OPTIONS.find((option) => option.id === presetId);
      if (!preset) {
        return;
      }
      setCronText(preset.expression);
      bumpFieldResetKey();
      onChange(buildCronCadence(preset.expression, cronTimeZone));
    },
    [cronTimeZone, onChange],
  );

  const handleCronChange = useCallback(
    (text: string) => {
      setCronText(text);
      onChange(buildCronCadence(text.trim(), cronTimeZone));
    },
    [cronTimeZone, onChange],
  );

  let feedback: ReactNode = null;
  if (effectiveError) {
    feedback = <span className="text-xs leading-[normal] text-red-300">{effectiveError}</span>;
  } else if (preview) {
    feedback = <span className="text-xs leading-[normal] text-muted-foreground">{preview}</span>;
  }

  return (
    <Field label="Cadence">
      <div className="flex flex-col gap-3">
        <SelectField
          label="Cadence"
          value={selectedPresetId === "custom" ? null : selectedPresetId}
          selectedDisplay={selectedPresetDisplay}
          options={PRESET_OPTIONS}
          onChange={handlePresetChange}
          placeholder="Select cadence"
          emptyText="No cadences found"
          searchable={false}
          title="Cadence"
          size={size}
          triggerTestID="schedule-cadence-preset-trigger"
          field={false}
        />

        <FormTextInput
          size={size}
          testID="cadence-cron-expression"
          accessibilityLabel="Cron expression"
          initialValue={cronText}
          resetKey={`cadence-cron-${fieldResetKey}`}
          onChangeText={handleCronChange}
          placeholder="0 9 * * *"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        {feedback}
      </div>
    </Field>
  );
}
