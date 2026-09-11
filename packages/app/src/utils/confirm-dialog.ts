import { Alert } from "react-native";
import { isNative } from "@/constants/platform";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmButtonConfig {
  confirmLabel: string;
  cancelLabel: string;
}

function resolveButtonLabels(input: ConfirmDialogInput): ConfirmButtonConfig {
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
        {
          text: labels.cancelLabel,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: labels.confirmLabel,
          style: input.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function showWebConfirmDialog(input: ConfirmDialogInput): boolean {
  const browserConfirm = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
  if (typeof browserConfirm !== "function") {
    throw new Error("[ConfirmDialog] No web confirmation backend is available.");
  }

  blurActiveWebElement();
  const promptMessage = `${input.title}\n\n${input.message}`;
  return browserConfirm(promptMessage);
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isNative) {
    return showNativeConfirmDialog(input);
  }

  return showWebConfirmDialog(input);
}

function blurActiveWebElement(): void {
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}
