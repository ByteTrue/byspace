// Port of packages/app/src/components/settings-textarea.tsx: a multiline settings field, a bare textarea in a settings card.
// Converted from the Expo file by web/scripts/port/settings-small-sections.py (tag archive/expo-app); edit it directly.
import { useEffect, useRef } from "react";
import { cn } from "cn";
import { settingsStyles } from "@/styles/settings";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";

interface SettingsTextAreaProps {
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
  /** Classes for the textarea (the Expo prop is a style). */
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
  // packages/app hands `value` over once, so a parent that resets it (the system prompt's Reset)
  // left the edited text on screen with Save disabled. Show what the parent holds; typing keeps
  // the two equal, so this only acts on an outside change.
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    if (inputRef.current && inputRef.current.getText() !== value)
      inputRef.current.replaceText(value);
  }, [value]);

  return (
    <TextInput
      ref={inputRef}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      multiline
      initialValue={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      className={cn(
        "block min-h-24 w-full resize-none bg-transparent px-4 py-3 text-sm leading-[normal] text-foreground placeholder:text-muted-foreground",
        className,
      )}
    />
  );
}

export function SettingsTextAreaCard(props: SettingsTextAreaProps) {
  return (
    <div className={settingsStyles.card}>
      <SettingsTextArea {...props} />
    </div>
  );
}
