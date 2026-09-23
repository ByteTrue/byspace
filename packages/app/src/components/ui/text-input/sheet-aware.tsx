import { forwardRef, useCallback } from "react";
import { TextInput as NativeTextInput, type TextInputProps } from "react-native";

/** Registers focus with the sheet so the keyboard can move the active input into view. */
export const SheetAwareTextInput = forwardRef<NativeTextInput, TextInputProps>(
  function SheetAwareTextInput(props, ref) {
    const setRef = useCallback(
      (input: NativeTextInput | null | undefined) => {
        if (typeof ref === "function") ref(input ?? null);
        else if (ref) ref.current = input ?? null;
      },
      [ref],
    );
    return <NativeTextInput {...props} ref={setRef} />;
  },
);
