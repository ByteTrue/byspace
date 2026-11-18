// Port of archive/expo-app:packages/app/src/components/keyboard-translate-view.tsx: a plain container. The
// browser moves content for the on-screen keyboard itself.
import type { ComponentProps, ReactNode } from "react";

export function KeyboardTranslateView({
  children,
  enabled: _enabled,
  ...props
}: ComponentProps<"div"> & { children: ReactNode; enabled?: boolean }) {
  return <div {...props}>{children}</div>;
}
