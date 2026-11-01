// Override of packages/app/src/components/ui/select-field.tsx: a field-sized trigger that opens a
// combobox of typed options. Same props; the trigger draws the input chrome.
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field } from "@/components/ui/form-field";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";

export interface SelectFieldDisplay {
  label: string;
  description?: string;
}

export interface SelectFieldOption<TValue> {
  id: string;
  value: TValue;
  label: string;
  description?: string;
  kind?: ComboboxOption["kind"];
  testID?: string;
}

export interface SelectFieldRenderOptionInput<TValue> {
  option: SelectFieldOption<TValue>;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}

export interface SelectFieldProps<TValue> {
  label: string;
  value: TValue | null;
  selectedDisplay: SelectFieldDisplay | null;
  options: SelectFieldOption<TValue>[];
  onChange: (value: TValue, display: SelectFieldDisplay) => void;
  placeholder: string;
  emptyText: string;
  loading?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string | null;
  searchable?: boolean;
  searchPlaceholder?: string;
  title?: string;
  size?: FieldControlSize;
  getValueKey?: (value: TValue) => string;
  renderOption?: (input: SelectFieldRenderOptionInput<TValue>) => ReactElement;
  triggerLeading?: ReactNode;
  field?: boolean;
  testID?: string;
  triggerTestID?: string;
}

export interface SelectFieldTriggerProps {
  display?: SelectFieldDisplay | null;
  label?: string;
  isPlaceholder?: boolean;
  placeholder: string;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leading?: ReactNode;
  size?: FieldControlSize;
  testID?: string;
}

/** The trigger's face: leading slot, value or placeholder, spinner, chevron. */
export function SelectFieldTrigger({
  display,
  label: explicitLabel,
  isPlaceholder: explicitIsPlaceholder,
  placeholder,
  active = false,
  disabled = false,
  loading = false,
  leading,
  size = "md",
  testID,
}: SelectFieldTriggerProps): ReactElement {
  const label = explicitLabel ?? display?.label ?? placeholder;
  const isPlaceholder = explicitIsPlaceholder ?? display == null;
  return (
    <span
      data-testid={testID}
      className={cn(
        // packages/app's control phases (control-geometry.ts): hover keeps the rest border; open,
        // pressed or focused (by any means, not only the keyboard) draw the ring border and the 3px
        // focus ring.
        "pointer-events-none flex w-full items-center gap-1.5 border border-input bg-transparent transition-colors group-focus/select:border-ring group-focus/select:ring-3 group-focus/select:ring-ring/50 group-active/select:border-ring group-active/select:ring-3 group-active/select:ring-ring/50 dark:bg-input/30",
        size === "sm" ? "h-8 rounded-md px-2.5 md:h-7" : "h-11 rounded-lg px-3 md:h-8 md:px-2.5",
        active && "border-ring ring-3 ring-ring/50",
        disabled && "opacity-50",
      )}
    >
      {leading}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          isPlaceholder ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {label}
      </span>
      {loading ? (
        <span className="flex w-4 shrink-0 items-center text-muted-foreground">
          <Spinner className="size-3.5" />
        </span>
      ) : null}
      <ChevronDown size={ICON_SIZE.md} className="shrink-0 text-muted-foreground" />
    </span>
  );
}

function getSelectedOptionId<TValue>(
  options: readonly SelectFieldOption<TValue>[],
  value: TValue | null,
  getValueKey: ((value: TValue) => string) | undefined,
): string {
  if (value === null) return "";
  if (getValueKey) {
    const selectedKey = getValueKey(value);
    return options.find((option) => getValueKey(option.value) === selectedKey)?.id ?? "";
  }
  return options.find((option) => Object.is(option.value, value))?.id ?? "";
}

/** While a reload is in flight with nothing yet, keep showing the previous options. */
function useVisibleSelectOptions<TValue>(
  options: SelectFieldOption<TValue>[],
  loading: boolean,
): SelectFieldOption<TValue>[] {
  const previousOptionsRef = useRef<SelectFieldOption<TValue>[]>(options);
  if (options.length > 0 || !loading) previousOptionsRef.current = options;
  if (loading && options.length === 0) return previousOptionsRef.current;
  return options;
}

export function SelectField<TValue>({
  label,
  value,
  selectedDisplay,
  options,
  onChange,
  placeholder,
  emptyText,
  loading = false,
  disabled = false,
  hint,
  error,
  searchable = false,
  searchPlaceholder,
  title,
  size = "md",
  getValueKey,
  renderOption,
  triggerLeading,
  field = true,
  testID,
  triggerTestID,
}: SelectFieldProps<TValue>): ReactElement {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const visibleOptions = useVisibleSelectOptions(options, loading);
  const selectedOptionId = useMemo(
    () => getSelectedOptionId(visibleOptions, value, getValueKey),
    [getValueKey, value, visibleOptions],
  );
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      visibleOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        kind: option.kind,
      })),
    [visibleOptions],
  );
  const optionById = useMemo(
    () => new Map(visibleOptions.map((option) => [option.id, option])),
    [visibleOptions],
  );
  const handleSelect = useCallback(
    (id: string) => {
      const option = optionById.get(id);
      if (!option) return;
      onChange(option.value, { label: option.label, description: option.description });
      setOpen(false);
    },
    [onChange, optionById],
  );
  const handlePress = useCallback(() => {
    if (!disabled) setOpen((current) => !current);
  }, [disabled]);
  const renderComboboxOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const selectOption = optionById.get(option.id);
      if (selectOption && renderOption)
        return renderOption({ option: selectOption, selected, active, onPress });
      return (
        <ComboboxItem
          testID={selectOption?.testID}
          label={option.label}
          description={option.description}
          kind={option.kind}
          selected={selected}
          active={active}
          onPress={onPress}
        />
      );
    },
    [optionById, renderOption],
  );
  const displayLabel = selectedDisplay?.label ?? placeholder;
  const control = (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={handlePress}
        disabled={disabled}
        aria-label={`${label} (${displayLabel})`}
        aria-expanded={open}
        data-testid={triggerTestID}
        // The global keyboard focus outline on the button and the ring on the field inside, both
        // as packages/app's (a Pressable round the field).
        className="group/select flex w-full"
      >
        <SelectFieldTrigger
          display={selectedDisplay}
          placeholder={placeholder}
          active={open}
          disabled={disabled}
          loading={loading}
          leading={triggerLeading}
          size={size}
        />
      </button>
      <Combobox
        options={comboboxOptions}
        value={selectedOptionId}
        onSelect={handleSelect}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        emptyText={loading && visibleOptions.length === 0 ? "Loading..." : emptyText}
        title={title ?? label}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        renderOption={renderComboboxOption}
      />
    </>
  );
  if (!field) return <div data-testid={testID}>{control}</div>;
  return (
    <Field label={label} hint={selectedDisplay?.description ?? hint} error={error} testID={testID}>
      {control}
    </Field>
  );
}
