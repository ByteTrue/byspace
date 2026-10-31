// Override of packages/app/src/components/toast-host.tsx: same API and timing, drawn with Tailwind.
import { CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";

export type ToastVariant = "default" | "info" | "success" | "warning" | "error";

export interface ToastShowOptions {
  icon?: ReactNode;
  variant?: ToastVariant;
  durationMs?: number | null;
  nativeAndroid?: boolean;
  testID?: string;
}

export interface ToastState {
  id: number;
  content: ReactNode;
  nativeMessage: string | null;
  icon?: ReactNode;
  variant: ToastVariant;
  durationMs: number | null;
  testID?: string;
}

export interface ToastApi {
  show: (content: ReactNode, options?: ToastShowOptions) => void;
  copied: (label?: string) => void;
  error: (message: string) => void;
}

const DEFAULT_DURATION_MS = 2200;

export function useToastHost(): { api: ToastApi; toast: ToastState | null; dismiss: () => void } {
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);

  const show = useCallback((content: ReactNode, options?: ToastShowOptions) => {
    const nativeMessage = typeof content === "string" ? content.trim() : null;
    if (!content || nativeMessage === "") return;
    idRef.current += 1;
    setToast({
      id: idRef.current,
      content,
      nativeMessage,
      icon: options?.icon,
      variant: options?.variant ?? "default",
      durationMs: options?.durationMs === undefined ? DEFAULT_DURATION_MS : options.durationMs,
      testID: options?.testID,
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      copied: (label?: string) =>
        show(label ? t("common.states.copiedLabel", { label }) : t("common.states.copied"), {
          variant: "success",
          icon: <CheckCircle2 className="size-4" />,
        }),
      error: (message: string) => show(message, { variant: "error", durationMs: 3200 }),
    }),
    [show, t],
  );

  const dismiss = useCallback(() => setToast(null), []);
  return { api, toast, dismiss };
}

export function ToastViewport({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  placement?: "app-shell" | "panel";
}) {
  useEffect(() => {
    if (!toast || toast.durationMs === null) return;
    const timer = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role="status"
        data-testid={toast.testID}
        className={cn(
          "pointer-events-auto flex max-w-[480px] items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md",
          toast.variant === "error" && "text-destructive-text",
        )}
      >
        {toast.icon}
        <div className="min-w-0 flex-1">{toast.content}</div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
