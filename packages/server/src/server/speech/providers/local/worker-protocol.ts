import type {
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
} from "../../speech-provider.js";
import type { LocalSpeechWorkerBytes } from "./worker-bytes.js";

export interface LocalSpeechWorkerConfig {
  modelsDir: string;
  dictationSttModel: string;
}

export type LocalSpeechSessionKind = "dictationStt";

export type LocalSpeechWorkerRequest =
  | {
      type: "session.create";
      requestId: string;
      config: LocalSpeechWorkerConfig;
      sessionId: string;
      kind: LocalSpeechSessionKind;
    }
  | { type: "session.append"; requestId: string; sessionId: string; audio: LocalSpeechWorkerBytes }
  | { type: "session.commit"; requestId: string; sessionId: string }
  | { type: "session.clear"; requestId: string; sessionId: string }
  | { type: "session.flush"; requestId: string; sessionId: string }
  | { type: "session.reset"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };

export type LocalSpeechWorkerResponse =
  | { type: "response"; requestId: string; ok: true; result?: unknown }
  | { type: "response"; requestId: string; ok: false; error: string };

export type LocalSpeechWorkerEvent =
  | {
      type: "session.committed";
      sessionId: string;
      payload: StreamingTranscriptionCommittedEvent;
    }
  | { type: "session.transcript"; sessionId: string; payload: StreamingTranscriptionEvent }
  | { type: "session.error"; sessionId: string; error: string };

export type LocalSpeechWorkerToParentMessage = LocalSpeechWorkerResponse | LocalSpeechWorkerEvent;

export interface LocalSpeechCreateSessionResult {
  requiredSampleRate: number;
}
