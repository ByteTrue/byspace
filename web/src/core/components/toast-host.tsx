// The app's toasts are shadcn's Sonner. This is the API the app calls them through: show a
// message, "copied", or an error.
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useThemeObject } from "~/app/theme-object";
import { Toaster } from "~/components/ui/sonner";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";

export type ToastVariant = "default" | "info" | "success" | "warning" | "error";

export interface ToastShowOptions {
  icon?: ReactNode;
  variant?: ToastVariant;
  /** null keeps it until dismissed. */
  durationMs?: number | null;
  nativeAndroid?: boolean;
  testID?: string;
  /** A toast shown again under the same id replaces it, and dismiss(id) removes it. */
  id?: string;
}

export interface ToastApi {
  show: (content: ReactNode, options?: ToastShowOptions) => void;
  copied: (label?: string) => void;
  error: (message: string) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 2200;

const SHOW = {
  default: toast,
  info: toast.info,
  success: toast.success,
  warning: toast.warning,
  error: toast.error,
} as const;

function show(content: ReactNode, options?: ToastShowOptions): void {
  if (!content || (typeof content === "string" && content.trim() === "")) return;
  const durationMs = options?.durationMs === undefined ? DEFAULT_DURATION_MS : options.durationMs;
  SHOW[options?.variant ?? "default"](content, {
    icon: options?.icon,
    id: options?.id,
    duration: durationMs ?? Number.POSITIVE_INFINITY,
    testId: options?.testID ?? "app-toast-message",
  });
}

export function useToastApi(): ToastApi {
  const { t } = useTranslation();
  return useMemo<ToastApi>(
    () => ({
      show,
      copied: (label?: string) =>
        show(label ? t("common.states.copiedLabel", { label }) : t("common.states.copied"), {
          variant: "success",
        }),
      error: (message: string) => show(message, { variant: "error", durationMs: 3200 }),
      dismiss: (id: string) => toast.dismiss(id),
    }),
    [t],
  );
}

// Below the workspace header and tab row (36 + 36 on desktop, the 56px phone header), so a toast
// that stays up, like "Reconnecting", never covers the tabs or the header controls.
const TOASTER_OFFSET = { top: HEADER_INNER_HEIGHT * 2 + 8 };
const TOASTER_MOBILE_OFFSET = {
  top: `calc(env(safe-area-inset-top) + ${HEADER_TOP_PADDING_MOBILE + HEADER_INNER_HEIGHT_MOBILE + 8}px)`,
};

/** The one Sonner toaster, in the app's light or dark scheme. */
export function AppToaster() {
  const theme = useThemeObject();
  return (
    <Toaster
      theme={theme.colorScheme}
      position="top-center"
      offset={TOASTER_OFFSET}
      mobileOffset={TOASTER_MOBILE_OFFSET}
    />
  );
}
