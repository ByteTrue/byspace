/** Dictation readiness shim (voice retired, issue 025 C8): never ready. */
export function useIsDictationReady(_input?: Record<string, unknown>): false {
  return false;
}
