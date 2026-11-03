// Port of archive/expo-app:packages/app/src/components/ui/select-field.tsx: a field-sized trigger that opens a
// combobox of typed options. Same props; the trigger draws the input chrome.
import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "cn";
import { buttonVariants } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";

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
  testID?: string;
}

/**
 * The trigger's face, shadcn's outline button: leading slot, value or placeholder, spinner,
 * chevron. It sits inside the button that opens the list (`group/select`), which owns focus.
 */
export function SelectFieldTrigger({
  display,
  label: explicitLabel,
  isPlaceholder: explicitIsPlaceholder,
  placeholder,
  active = false,
  disabled = false,
  loading = false,
  leading,
  testID,
}: SelectFieldTriggerProps): ReactElement {
  const label = explicitLabel ?? display?.label ?? placeholder;
  const isPlaceholder = explicitIsPlaceholder ?? display == null;
  return (
    <span
      data-testid={testID}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "pointer-events-none w-full justify-start font-normal group-focus-visible/select:border-ring group-focus-visible/select:ring-3 group-focus-visible/select:ring-ring/50",
        active && "bg-muted",
        disabled && "opacity-50",
      )}
    >
      {leading}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          isPlaceholder && "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {loading ? <Spinner className="text-muted-foreground" /> : null}
      <ChevronDown className="text-muted-foreground" />
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
        // as the Expo app's (a Pressable round the field).
        className="group/select flex w-full"
      >
        <SelectFieldTrigger
          display={selectedDisplay}
          placeholder={placeholder}
          active={open}
          disabled={disabled}
          loading={loading}
          leading={triggerLeading}
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
    <Field data-testid={testID} data-invalid={Boolean(error)}>
      <FieldLabel>{label}</FieldLabel>
      {control}
      {(selectedDisplay?.description ?? hint) ? (
        <FieldDescription data-testid={`${testID}-hint`}>
          {selectedDisplay?.description ?? hint}
        </FieldDescription>
      ) : null}
      <FieldError data-testid={`${testID}-error`}>{error}</FieldError>
    </Field>
  );
}
