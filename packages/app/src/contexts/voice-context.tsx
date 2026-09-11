/**
 * Voice context shim (voice retired, issue 025 C8).
 *
 * The voice runtime, dictation, and realtime voice overlay are gone. These
 * hooks keep the "optional voice" contract — always absent on web — so
 * shared UI keeps its null-guards. New code must not import from here.
 */
import type { ReactNode } from "react";

export interface VoiceRuntimeLike {
  readonly isVoiceModeForAgent: (_serverId: string, _agentId: string) => false;
  readonly isVoiceSwitching: false;
  readonly isMuted: false;
  readonly startVoice: (_serverId: string, _agentId: string) => Promise<void>;
  readonly stopVoice: () => Promise<void>;
  readonly toggleMute: () => void;
}

export function VoiceProvider(props: { children: ReactNode }): ReactNode {
  return props.children;
}

export function useVoiceOptional(): null {
  return null;
}

export function useVoiceRuntimeOptional(): null {
  return null;
}

export function useVoiceAudioEngineOptional(): null {
  return null;
}

export function useIsVoiceAvailable(): false {
  return false;
}
