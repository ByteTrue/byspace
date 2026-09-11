/**
 * Dictation overlay shim (voice retired, issue 025 C8).
 *
 * The overlay never renders: `showDictationOverlay` is permanently false
 * upstream. The props shape mirrors the retired component so the composer
 * keeps type-checking.
 */
import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DictationOverlayStatus = "idle" | "listening" | "processing" | "failed" | "completed";

export function DictationOverlay(_props: any): ReactNode {
  return null;
}
