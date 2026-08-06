import { createContext, useContext, useRef, type ReactNode } from "react";
import { createAudioEngine } from "@/voice/audio-engine";
import type { AudioEngine } from "@/voice/audio-engine-types";

const AudioEngineContext = createContext<AudioEngine | null>(null);

export function useAudioEngineOptional(): AudioEngine | null {
  return useContext(AudioEngineContext);
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createAudioEngine({
      onCaptureData: () => {},
      onVolumeLevel: () => {},
      onInterruption: () => {},
      onError: (error) => console.error("[AudioEngine] Error:", error),
    });
  }
  return (
    <AudioEngineContext.Provider value={engineRef.current}>{children}</AudioEngineContext.Provider>
  );
}
