import type { TextInputProps } from "react-native";

export interface EditingTextInputHandle {
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  getText(): string;
  replaceText(text: string, selection?: { start: number; end: number }): void;
  getNativeRef(): unknown;
}

export interface EditingTextInputProps extends Omit<
  TextInputProps,
  "defaultValue" | "onChangeText" | "value"
> {
  /** Seeds the editing surface once. The surface owns subsequent edits; programmatic replacement goes through `replaceText`. */
  initialValue?: string;
  onChangeText?: (text: string) => void;
}
