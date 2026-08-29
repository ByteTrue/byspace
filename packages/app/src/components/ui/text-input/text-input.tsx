import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { TextInput } from "react-native";
import type { EditingTextInputHandle, EditingTextInputProps } from "./types";

type NativeInput = TextInput & {
  getNativeRef?(): unknown;
  setNativeProps?(props: { text?: string; selection?: { start: number; end: number } }): void;
  setSelection?(start: number, end: number): void;
};

/**
 * Shared editing primitive. The platform build (this file) renders a plain
 * TextInput; the Web build (`./text-input.web`) owns IME composition. The
 * imperative handle is the only sanctioned way to replace text programmatically
 * — controlled `value` replay is rejected at the type level.
 */
export const EditingTextInput = forwardRef<EditingTextInputHandle, EditingTextInputProps>(
  function EditingTextInputImpl(allProps, ref) {
    const {
      initialValue = "",
      onChangeText,
      value: _,
      defaultValue: __,
      ...props
    } = allProps as EditingTextInputProps & { value?: unknown; defaultValue?: unknown };
    const inputRef = useRef<NativeInput | null>(null);
    const initialTextRef = useRef(initialValue);
    const textRef = useRef(initialTextRef.current);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      isFocused: () => inputRef.current?.isFocused() ?? false,
      getText: () => textRef.current,
      replaceText: (nextText, selection) => {
        textRef.current = nextText;
        inputRef.current?.setNativeProps?.({
          text: nextText,
          ...(selection ? { selection } : {}),
        });
        if (selection) inputRef.current?.setSelection?.(selection.start, selection.end);
      },
      getNativeRef: () => inputRef.current?.getNativeRef?.() ?? inputRef.current,
    }));

    const handleChangeText = useCallback(
      (nextText: string) => {
        textRef.current = nextText;
        onChangeText?.(nextText);
      },
      [onChangeText],
    );

    return (
      <TextInput
        {...props}
        ref={inputRef}
        defaultValue={initialTextRef.current}
        onChangeText={handleChangeText}
      />
    );
  },
);
