// Port of archive/expo-app:packages/app/src/components/ui/text-input: a DOM-owned text field. The DOM holds
// the text between publications; `onChangeText` reports it, and the handle reads and replaces it
// without a controlled `value` round-trip. Composition (IME) input reports once it ends.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type SyntheticEvent,
  type TextareaHTMLAttributes,
} from "react";
import type { NativePastedFile } from "@/composer/native-pasted-image";
import { cn } from "cn";

export interface EditingTextInputHandle {
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  getText(): string;
  replaceText(text: string, selection?: { start: number; end: number }): void;
  /** Clear the editor and reset its intrinsic layout, preserving focus intent. */
  reset(): void;
  getNativeRef(): HTMLInputElement | HTMLTextAreaElement | null;
}

type FieldElement = HTMLInputElement & HTMLTextAreaElement;

export interface EditingTextInputProps extends Omit<
  TextareaHTMLAttributes<FieldElement>,
  "value" | "defaultValue" | "onChange" | "onSelect" | "onKeyDown" | "autoCorrect"
> {
  initialValue?: string;
  onChangeText?: (text: string) => void;
  /** Enter in a single-line field. */
  onSubmitEditing?: () => void;
  onKeyDown?: (event: KeyboardEvent<FieldElement>) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  /** A textarea instead of an input. */
  multiline?: boolean;
  editable?: boolean;
  type?: string;
  testID?: string;
  accessibilityLabel?: string;
  /** Native-only paste hooks; the web reads pasted images from the paste event. */
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  onPasteError?: (message: string) => void;
  variant?: "default" | "bottom-sheet";
  /** React Native's boolean form is accepted alongside "on"/"off". */
  autoCorrect?: boolean | "on" | "off";
  /** Visible lines of a multiline field (React Native's name for `rows`). */
  numberOfLines?: number;
  /** Selects the whole value when the field gains focus. */
  selectTextOnFocus?: boolean;
  /** React Native's keyboard hint; maps to `inputMode` when that is not given. */
  keyboardType?:
    | "default"
    | "number-pad"
    | "numeric"
    | "decimal-pad"
    | "email-address"
    | "url"
    | "phone-pad";
  /** React Native's placeholder colour; the stylesheet colours placeholders on the web. */
  placeholderTextColor?: string;
}

const KEYBOARD_INPUT_MODE = {
  default: undefined,
  "number-pad": "numeric",
  numeric: "numeric",
  "decimal-pad": "decimal",
  "email-address": "email",
  url: "url",
  "phone-pad": "tel",
} as const;

function toAutoCorrect(value: boolean | "on" | "off" | undefined): "on" | "off" | undefined {
  if (value === true) return "on";
  if (value === false) return "off";
  return value;
}

export const EditingTextInput = forwardRef<EditingTextInputHandle, EditingTextInputProps>(
  function EditingTextInput(
    {
      initialValue = "",
      onChangeText,
      onSubmitEditing,
      onKeyDown,
      onSelectionChange,
      multiline = false,
      editable = true,
      type,
      testID,
      accessibilityLabel,
      onPasteImages: _onPasteImages,
      onPasteError: _onPasteError,
      variant: _variant,
      autoCorrect,
      numberOfLines,
      selectTextOnFocus,
      keyboardType,
      placeholderTextColor: _placeholderTextColor,
      ...props
    },
    ref,
  ) {
    const inputRef = useRef<FieldElement | null>(null);
    const initialTextRef = useRef(initialValue);
    const textRef = useRef(initialTextRef.current);
    const isComposingRef = useRef(false);
    const onChangeTextRef = useRef(onChangeText);
    onChangeTextRef.current = onChangeText;

    useEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      const startComposition = () => {
        isComposingRef.current = true;
      };
      const endComposition = () => {
        isComposingRef.current = false;
        const nextText = input.value;
        if (nextText === textRef.current) return;
        textRef.current = nextText;
        onChangeTextRef.current?.(nextText);
      };
      input.addEventListener("compositionstart", startComposition);
      input.addEventListener("compositionend", endComposition);
      return () => {
        input.removeEventListener("compositionstart", startComposition);
        input.removeEventListener("compositionend", endComposition);
      };
    }, []);

    const handleChange = useCallback((event: ChangeEvent<FieldElement>) => {
      const nextText = event.target.value;
      if (isComposingRef.current || nextText === textRef.current) return;
      textRef.current = nextText;
      onChangeTextRef.current?.(nextText);
    }, []);

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<FieldElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || multiline || !onSubmitEditing) return;
        if (event.key === "Enter" && !event.nativeEvent.isComposing) onSubmitEditing();
      },
      [multiline, onKeyDown, onSubmitEditing],
    );

    const handleSelect = useCallback(
      (event: SyntheticEvent<FieldElement>) => {
        const { selectionStart, selectionEnd } = event.currentTarget;
        const start = selectionStart ?? 0;
        onSelectionChange?.({ start, end: selectionEnd ?? start });
      },
      [onSelectionChange],
    );

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      isFocused: () => document.activeElement === inputRef.current,
      getText: () => {
        const nextText = inputRef.current?.value ?? textRef.current;
        textRef.current = nextText;
        return nextText;
      },
      replaceText: (nextText, selection) => {
        textRef.current = nextText;
        const input = inputRef.current;
        if (!input) return;
        input.value = nextText;
        if (selection) input.setSelectionRange(selection.start, selection.end);
      },
      reset: () => {
        textRef.current = "";
        if (inputRef.current) inputRef.current.value = "";
      },
      getNativeRef: () => inputRef.current,
    }));

    const { onFocus } = props;
    const handleFocus = useCallback(
      (event: FocusEvent<FieldElement>) => {
        onFocus?.(event);
        if (selectTextOnFocus) event.currentTarget.select();
      },
      [onFocus, selectTextOnFocus],
    );

    const shared = {
      ...props,
      inputMode: props.inputMode ?? (keyboardType ? KEYBOARD_INPUT_MODE[keyboardType] : undefined),
      onFocus: selectTextOnFocus ? handleFocus : onFocus,
      ref: inputRef,
      defaultValue: initialTextRef.current,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onSelect: onSelectionChange ? handleSelect : undefined,
      readOnly: editable ? props.readOnly : true,
      "aria-label": accessibilityLabel ?? props["aria-label"],
      "data-testid": testID,
      autoCorrect: toAutoCorrect(autoCorrect),
    };
    if (multiline) {
      // react-native-web's multiline TextInput has no resize grip
      return (
        <textarea
          rows={numberOfLines ?? props.rows}
          {...shared}
          className={cn("resize-none", props.className)}
        />
      );
    }
    return <input {...shared} type={type} />;
  },
);
