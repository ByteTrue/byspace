/** Voice bridge types shim (voice retired, issue 025 C8). */

export type VoiceSpeakHandler = (input: {
  audioBase64: string;
  format: string;
  [key: string]: unknown;
}) => Promise<void> | void;

export interface VoiceCallerContext {
  source?: string;
  lockedCwd?: string;
  allowCustomCwd?: boolean;
  enableVoiceTools?: boolean;
  childAgentDefaultLabels?: Record<string, string>;
  [key: string]: unknown;
}
