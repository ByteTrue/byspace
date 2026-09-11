/**
 * Realtime voice overlay shim (voice retired, issue 025 C8).
 *
 * The overlay never renders: `voice` is permanently null upstream. Props
 * mirror the retired component so the composer keeps type-checking.
 */
import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function RealtimeVoiceOverlay(_props: any): ReactNode {
  return null;
}
