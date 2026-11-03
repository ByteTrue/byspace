import { useCallback } from "react";
import type { ChangeEvent } from "react";
import { Textarea } from "~/components/ui/textarea";

interface SettingsTextAreaProps {
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
  className?: string;
}

export function SettingsTextArea({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  testID,
  className,
}: SettingsTextAreaProps) {
  const handleFieldInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => onChangeText(event.target.value),
    [onChangeText],
  );
  return (
    <Textarea
      data-testid={testID}
      aria-label={accessibilityLabel}
      value={value}
      onChange={handleFieldInput}
      placeholder={placeholder}
      className={className}
    />
  );
}
