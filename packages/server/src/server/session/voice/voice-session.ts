/**
 * Voice session shim (voice retired, issue 025 C8).
 *
 * The realtime voice session, dictation streaming, and voice-mode auto
 * permissions are gone. The class keeps the dispatch surface so the session
 * router stays intact; every method reports retired or does nothing.
 */

export class VoiceSession {
  isActiveForAgent(_agentId: string): false {
    return false;
  }

  handleAudioChunk(_msg: unknown): Promise<void> {
    return Promise.resolve();
  }

  handleAbort(): Promise<void> {
    return Promise.resolve();
  }

  handleAudioPlayed(_id: string): void {}

  handleSetVoiceMode(
    _enabled: boolean,
    _agentId: string | undefined,
    requestId: string,
  ): Promise<void> {
    // Voice mode is retired (issue 025 C8); acknowledge with mode off.
    void this.emitRetiredResponse(requestId);
    return Promise.resolve();
  }

  handleDictationStreamStart(_msg: unknown): Promise<void> {
    return Promise.resolve();
  }

  handleDictationChunk(_input: Record<string, unknown>): Promise<void> {
    return Promise.resolve();
  }

  handleDictationFinish(_dictationId: string, _finalSeq: number): Promise<void> {
    return Promise.resolve();
  }

  handleDictationCancel(_dictationId: string): void {}

  dispose(): void {}

  private async emitRetiredResponse(_requestId: string): Promise<void> {
    // The session-level emit wiring is owned by Session; the retired
    // acknowledgment is emitted there via the voiceBridge absence.
  }
}
