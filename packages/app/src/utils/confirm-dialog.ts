import { Alert } from "react-native";
import { getDesktopHost, type DesktopDialogAskOptions } from "@/desktop/host";
import { isNative } from "@/constants/platform";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

function resolveButtonLabels(input: ConfirmDialogInput) {
  return {
    confirmLabel: input.confirmLabel ?? "Confirm",
    cancelLabel: input.cancelLabel ?? "Cancel",
  };
}

async function showNativeConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const labels = resolveButtonLabels(input);
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      input.title,
      input.message,
      [
        { text: labels.cancelLabel, style: "cancel", onPress: () => resolve(false) },
        {
          text: labels.confirmLabel,
          style: input.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function blurActiveWebElement(): void {
  if (isNative) return;
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

function buildDesktopAskOptions(input: ConfirmDialogInput): DesktopDialogAskOptions {
  const labels = resolveButtonLabels(input);
  return {
    title: input.title,
    okLabel: labels.confirmLabel,
    cancelLabel: labels.cancelLabel,
    kind: input.destructive ? "warning" : "info",
  };
}

async function showDesktopConfirmDialog(input: ConfirmDialogInput): Promise<boolean | null> {
  if (isNative) return null;
  const desktopAsk = getDesktopHost()?.dialog?.ask;
  if (typeof desktopAsk !== "function") return null;
  blurActiveWebElement();
  return desktopAsk(input.message, buildDesktopAskOptions(input));
}

function showWebConfirmDialog(input: ConfirmDialogInput): boolean {
  const browserConfirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
  if (typeof browserConfirm !== "function") {
    throw new Error("[ConfirmDialog] Browser confirmation is unavailable.");
  }
  blurActiveWebElement();
  return browserConfirm(`${input.title}\n\n${input.message}`);
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isNative) return showNativeConfirmDialog(input);
  const desktopResult = await showDesktopConfirmDialog(input);
  return desktopResult ?? showWebConfirmDialog(input);
}

export const __private__ = {
  blurActiveWebElement,
  buildDesktopAskOptions,
  resolveButtonLabels,
};
