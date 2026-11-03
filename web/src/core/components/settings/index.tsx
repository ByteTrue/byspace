// Port of archive/expo-app:packages/app/src/components/settings/index.tsx: the settings card, row and the
// switch / select / input / action rows built on it. Same props; the view is DOM.
import { Children, isValidElement, type ReactNode } from "react";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
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
        checked={value}
        onCheckedChange={onValueChange}
        disabled={disabled}
        aria-label={row.label}
      />
    </SettingsRow>
  );
}

export function SettingsAction({ actionLabel, onPress, disabled, ...row }: SettingsActionProps) {
  return (
    <SettingsRow {...row}>
      <Button variant="outline" size="sm" onClick={onPress} disabled={disabled}>
        {actionLabel}
      </Button>
    </SettingsRow>
  );
}
