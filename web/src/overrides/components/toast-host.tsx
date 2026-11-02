// Override of packages/app/src/components/toast-host.tsx in DOM: the same API, timing and look. A toast
// drops in below the header (or 12px into its panel), fades and slides 8px over 140ms, pauses while
// the pointer is on it, and has no close button.
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  useIsCompactFormFactor,
} from "@/constants/layout";
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
          icon: <CheckCircle2 className="size-[18px] text-foreground" />,
        }),
      error: (message: string) => show(message, { variant: "error", durationMs: 3200 }),
    }),
    [show, t],
  );

  const dismiss = useCallback(() => setToast(null), []);
  return { api, toast, dismiss };
}

const ANIMATION_MS = 140;

const BORDER: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-border",
  info: "border-blue-300",
  warning: "border-amber-500",
  error: "border-destructive",
};

function defaultIcon(variant: ToastVariant): ReactNode {
  switch (variant) {
    case "info":
      return <Info className="size-[18px] text-blue-300" />;
    case "success":
      return <CheckCircle2 className="size-[18px] text-primary" />;
    case "warning":
      return <AlertTriangle className="size-[18px] text-amber-500" />;
    case "error":
      return <AlertTriangle className="size-[18px] text-destructive" />;
    default:
      return null;
  }
}

export function ToastViewport({
  toast,
  onDismiss,
  placement = "app-shell",
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  placement?: "app-shell" | "panel";
}) {
  const isMobile = useIsCompactFormFactor();
  if (!toast) return null;
  const headerOffset = isMobile
    ? HEADER_TOP_PADDING_MOBILE + HEADER_INNER_HEIGHT_MOBILE
    : HEADER_INNER_HEIGHT;
  const marginTop =
    placement === "app-shell" ? `calc(env(safe-area-inset-top) + ${headerOffset + 8}px)` : "12px";
  const content = (
    <div
      className={cn(
        "pointer-events-none inset-x-4 top-0 z-[10000] flex justify-center",
        placement === "app-shell" ? "fixed" : "absolute",
      )}
    >
      <div className="flex w-[92%] max-w-[480px] justify-center">
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} marginTop={marginTop} />
      </div>
    </div>
  );
  return placement === "app-shell" ? createPortal(content, document.body) : content;
}

function ToastCard({
  toast,
  onDismiss,
  marginTop,
}: {
  toast: ToastState;
  onDismiss: () => void;
  marginTop: string;
}) {
  const [shown, setShown] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const remainingRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);
  const animateOut = useCallback(() => {
    clearTimer();
    setShown(false);
    timeoutRef.current = window.setTimeout(onDismiss, ANIMATION_MS);
  }, [clearTimer, onDismiss]);
  const scheduleDismiss = useCallback(
    (durationMs: number | null) => {
      clearTimer();
      if (durationMs === null) {
        remainingRef.current = 0;
        deadlineRef.current = null;
        return;
      }
      remainingRef.current = Math.max(0, durationMs);
      deadlineRef.current = Date.now() + remainingRef.current;
      timeoutRef.current = window.setTimeout(animateOut, remainingRef.current);
    },
    [animateOut, clearTimer],
  );
  const pauseDismiss = useCallback(() => {
    if (deadlineRef.current !== null) {
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
    }
    deadlineRef.current = null;
    clearTimer();
  }, [clearTimer]);
  const resumeDismiss = useCallback(() => {
    if (toast.durationMs === null) return;
    scheduleDismiss(remainingRef.current || toast.durationMs);
  }, [scheduleDismiss, toast.durationMs]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    scheduleDismiss(toast.durationMs);
    return () => {
      cancelAnimationFrame(frame);
      clearTimer();
    };
  }, [clearTimer, scheduleDismiss, toast.durationMs]);

  const style = useMemo(() => ({ marginTop }), [marginTop]);
  const icon = toast.icon ?? defaultIcon(toast.variant);
  return (
    <div
      role="alert"
      data-testid={toast.testID ?? "app-toast"}
      onMouseEnter={pauseDismiss}
      onMouseLeave={resumeDismiss}
      style={style}
      className={cn(
        "pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border bg-background px-3 py-2 shadow-md transition-[opacity,translate] duration-[140ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
        BORDER[toast.variant],
        shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
    >
      {icon ? <span className="flex items-center justify-center">{icon}</span> : null}
      {typeof toast.content === "string" ? (
        <span data-testid="app-toast-message" className="shrink text-sm text-foreground">
          {toast.content}
        </span>
      ) : (
        <div data-testid="app-toast-message" className="min-w-0 shrink">
          {toast.content}
        </div>
      )}
    </div>
  );
}
