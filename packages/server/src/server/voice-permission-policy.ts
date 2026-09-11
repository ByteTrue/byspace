/** Voice permission policy shim (voice retired, issue 025 C8). */
export function isVoicePermissionAllowed(_request: unknown): false {
  return false;
}
