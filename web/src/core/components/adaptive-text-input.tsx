// Port of archive/expo-app:packages/app/src/components/adaptive-text-input.tsx: a text field whose content is
// replaced by `initialValue` whenever `resetKey` changes.
import { forwardRef, useCallback, useEffect, useRef } from "react";
import {
  EditingTextInput,
  type EditingTextInputHandle,
  type EditingTextInputProps,
} from "@/components/ui/text-input";
import { cn } from "cn";

export type AdaptiveTextInputProps = EditingTextInputProps & {
  initialValue?: string;
  resetKey?: string | number;
};

export const AdaptiveTextInput = forwardRef<EditingTextInputHandle, AdaptiveTextInputProps>(
  function AdaptiveTextInput({ initialValue, resetKey, className, ...props }, ref) {
    const inputRef = useRef<EditingTextInputHandle | null>(null);
    const replacementTextRef = useRef(initialValue ?? "");
    const previousResetKeyRef = useRef(resetKey);
    replacementTextRef.current = initialValue ?? "";
    const setInputRef = useCallback(
      (handle: EditingTextInputHandle | null) => {
        inputRef.current = handle;
        if (typeof ref === "function") ref(handle);
        else if (ref) ref.current = handle;
      },
      [ref],
    );
    useEffect(() => {
      if (resetKey === previousResetKeyRef.current) return;
      previousResetKeyRef.current = resetKey;
      inputRef.current?.replaceText(replacementTextRef.current);
    }, [resetKey]);
    return (
      <EditingTextInput
        {...props}
        ref={setInputRef}
        initialValue={initialValue}
        // No outline-none: like the Expo app's TextInput, the field shows the app's focus ring
        // unless its caller turns it off.
        className={cn("text-foreground placeholder:text-muted-foreground", className)}
      />
    );
  },
);
