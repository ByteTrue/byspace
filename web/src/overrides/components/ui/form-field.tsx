// Override of packages/app/src/components/ui/form-field.tsx: a labelled field (label, control,
// then the error or the hint) and shadcn's input for its text control.
import { forwardRef, type ReactNode } from "react";
import { AdaptiveTextInput, type AdaptiveTextInputProps } from "@/components/adaptive-text-input";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { cn } from "cn";

export function Field({
  label,
  children,
  hint,
  error,
  testID,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
  testID?: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid={testID}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {error ? (
        <span
          className="truncate text-xs leading-[17px] text-destructive"
          data-testid={testID ? `${testID}-error` : undefined}
        >
          {error}
        </span>
      ) : null}
      {!error && hint ? (
        <span
          className="text-xs leading-[17px] text-muted-foreground"
          data-testid={testID ? `${testID}-hint` : undefined}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** shadcn's input chrome; sm is 32px on a phone and 28px on desktop, md 44px and 32px. */
export function formInputClassName(size: FieldControlSize = "md", className?: string): string {
  return cn(
    "w-full min-w-0 border border-input bg-transparent text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 read-only:cursor-not-allowed read-only:opacity-50 dark:bg-input/30",
    size === "sm" ? "h-8 rounded-md px-2.5 md:h-7" : "h-11 rounded-lg px-3 md:h-8 md:px-2.5",
    className,
  );
}

export const FormTextInput = forwardRef<
  EditingTextInputHandle,
  AdaptiveTextInputProps & { size?: FieldControlSize }
>(function FormTextInput({ size = "md", className, multiline, ...props }, ref) {
  return (
    <AdaptiveTextInput
      ref={ref}
      multiline={multiline}
      className={formInputClassName(
        size,
        cn(multiline && "h-auto min-h-16 py-2 md:h-auto", className),
      )}
      {...props}
    />
  );
});
