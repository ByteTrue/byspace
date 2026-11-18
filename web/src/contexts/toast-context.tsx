import type { ReactNode } from "react";
import { AppToaster, useToastApi } from "@/components/toast-host";
import { ToastApiProvider } from "./toast-api-context";

export { ToastApiProvider, useToast } from "./toast-api-context";

export function ToastProvider({ children }: { children: ReactNode }) {
  const api = useToastApi();
  return (
    <ToastApiProvider api={api}>
      {children}
      <AppToaster />
    </ToastApiProvider>
  );
}
