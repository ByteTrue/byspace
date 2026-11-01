// Override of packages/app/src/components/settings/index.tsx: the settings card, row and the
// switch / select / input / action rows built on it. Same props; the view is DOM.
import {
  Children,
  isValidElement,
  useCallback,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { cn } from "cn";
export { SettingsGroup } from "@/components/settings/headings/settings-group";
export { SettingsSection } from "@/components/settings/headings/settings-section";

export interface SettingsRowProps {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
  testID?: string;
}
export interface SettingsSwitchProps extends SettingsRowProps {
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
}
export interface SettingsSelectProps<Value extends string = string> extends SettingsRowProps {
  value: Value;
  options: readonly { label: string; value: Value }[];
  onValueChange(value: Value): void;
  disabled?: boolean;
}
export interface SettingsInputHandle {
  focus(): void;
  blur(): void;
  getText(): string;
  replaceText(text: string): void;
}
export interface SettingsInputProps extends SettingsRowProps {
  initialValue?: string;
  onChangeText(text: string): void;
  placeholder?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
  ref?: Ref<SettingsInputHandle>;
}
export interface SettingsActionProps extends SettingsRowProps {
  actionLabel: string;
  onPress(): void;
  disabled?: boolean;
}

export function SettingsCard({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <div className={settingsStyles.card} data-testid={testID}>
      {Children.toArray(children).map((child, index) => (
        <div
          key={isValidElement(child) ? child.key : index}
          className={cn("flex flex-col", index > 0 && settingsStyles.rowBorder)}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function SettingsRow({ label, hint, error, children, testID }: SettingsRowProps) {
  const compact = useIsCompactFormFactor();
  return (
    <div className={cn(settingsStyles.row, compact && "flex-wrap gap-3")} data-testid={testID}>
      <div className="mr-3 flex shrink grow basis-40 flex-col">
        <span className={settingsStyles.rowTitle}>{label}</span>
        {hint ? <span className={settingsStyles.rowHint}>{hint}</span> : null}
        {error ? (
          <span role="alert" className={settingsStyles.rowError}>
            {error}
          </span>
        ) : null}
      </div>
      {children ? <div className="flex max-w-full shrink">{children}</div> : null}
    </div>
  );
}

export function SettingsSwitch({ value, onValueChange, disabled, ...row }: SettingsSwitchProps) {
  return (
    <SettingsRow {...row}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={row.label}
      />
    </SettingsRow>
  );
}

function SettingsOption<Value extends string>({
  option,
  selected,
  onValueChange,
}: {
  option: { label: string; value: Value };
  selected: boolean;
  onValueChange(value: Value): void;
}) {
  const select = useCallback(() => onValueChange(option.value), [onValueChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {option.label}
    </DropdownMenuItem>
  );
}

export function SettingsSelect<Value extends string>({
  value,
  options,
  onValueChange,
  disabled,
  ...row
}: SettingsSelectProps<Value>) {
  return (
    <SettingsRow {...row}>
      <DropdownMenu>
        <DropdownTrigger disabled={disabled} accessibilityLabel={row.label}>
          <span className="text-sm text-foreground">
            {options.find((option) => option.value === value)?.label ?? value}
          </span>
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={220}>
          {options.map((option) => (
            <SettingsOption
              key={option.value}
              option={option}
              selected={option.value === value}
              onValueChange={onValueChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  );
}

export function SettingsInput({
  initialValue,
  onChangeText,
  placeholder,
  disabled,
  secureTextEntry,
  ref,
  ...row
}: SettingsInputProps) {
  const compact = useIsCompactFormFactor();
  const input = useRef<EditingTextInputHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
      getText: () => input.current?.getText() ?? "",
      replaceText: (text) => input.current?.replaceText(text),
    }),
    [],
  );
  return (
    <SettingsRow {...row}>
      <FormTextInput
        ref={input}
        initialValue={initialValue}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={!disabled}
        type={secureTextEntry ? "password" : undefined}
        accessibilityLabel={row.label}
        size={compact ? "md" : "sm"}
        className="min-w-[180px]"
      />
    </SettingsRow>
  );
}

export function SettingsAction({ actionLabel, onPress, disabled, ...row }: SettingsActionProps) {
  return (
    <SettingsRow {...row}>
      <Button variant="outline" size="sm" onPress={onPress} disabled={disabled}>
        {actionLabel}
      </Button>
    </SettingsRow>
  );
}
