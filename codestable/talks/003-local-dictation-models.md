# Local dictation models

## Context

BySpace currently exposes both composer dictation and a separate Voice mode. Voice mode adds VAD, agent prompt rewriting, a `byspace_voice.speak` tool, daemon TTS, and browser playback, but is not usable enough to justify the product and maintenance surface. The product need is narrower: high-quality local speech-to-text that inserts text into the composer.

The current local speech runtime silently chooses and downloads a default Parakeet model. The app cannot see or choose the effective model. Existing local models do not cover Mandarin.

Orca's model picker was reviewed as a reference. Its useful boundary is a host-owned, allowlisted STT catalog with explicit install/select/delete operations; it does not support arbitrary models and it does not select an agent LLM or TTS voice.

## Decisions

1. BySpace keeps Dictation only. Voice mode UI, VAD/TTS runtime, agent prompt mutation, and the `byspace_voice.speak` bridge are removed.
2. Old Voice mode wire messages and persisted configuration remain parseable as dated compatibility shims. A new daemon rejects attempts to enable Voice mode instead of executing it.
3. Dictation is unconfigured by default. Starting a daemon never downloads a speech model automatically.
4. A model must be explicitly installed and selected on each Host before dictation is available.
5. The catalog contains FireRedASR2-AED ONNX int8 for Mandarin-first quality and SenseVoice Small ONNX int8 for a substantially smaller/faster multilingual option with punctuation. Only the selected model is loaded.
6. SenseVoice was accepted only after the production sherpa Node path and the same Mandarin, English, and mixed fixtures were measured. Its archive is ~163 MB; the 11.5-second fixture decoded in ~0.5 seconds at ~0.95 GB peak RSS versus FireRed at ~4.2 seconds and ~4.0 GB.
7. Qwen3-ASR 0.6B is deferred because the latest stable sherpa-onnx Node binding does not expose its recognizer configuration; a downloadable but unusable option is not shipped.
8. Execution remains cross-platform CPU-only through sherpa-onnx 1.13.4. The previous 1.12.28 Node package cannot construct the FireRed offline recognizer (`OfflineRecognizer is not a constructor`); the real worker test passes after the upgrade. No Python, CUDA, cloud speech provider, or arbitrary model URL is introduced.
9. The daemon owns the allowlisted catalog, model files, download jobs, selected model, and recognition runtime. The browser only controls the current Host.
10. New clients capability-gate model management through `server_info.features.speechModelSelection`; no degraded fallback is built for old daemons.
11. Selection changes apply to the next dictation session. Active dictation is not silently switched underneath a recording.
12. Existing downloaded files are not automatically deleted.
13. Optional AI refinement is off by default and sends transcript text, never audio. It directly reuses the same structured-generation provider resolution and non-persisted internal Agent path as titles, commit messages, and PR text, so it supports the same Provider set. Provider or schema failures fail open to raw ASR output; the composer retains both raw and refined drafts behind a reversible toggle.
14. Refinement is a reversible draft, not a claim of semantic equivalence: the composer retains both raw and cleaned text behind a visible toggle. It never submits automatically.
15. Model downloads are stream-capped at the allowlisted catalog size before exact-size and SHA-256 verification, preventing malformed overlong responses from consuming unbounded Host disk.

## UX

A compact `Dictation` Host settings section lists both models with language/quality focus, download size, and status. Actions are limited to install/use, switch, and delete. While a model is downloading, the client polls the Host-owned state.

The same section contains one `Refine with AI` switch, default off. Its description discloses the extra model call and text-only provider boundary. After a successful refinement, the composer labels the result and keeps `Use original` / `Use AI cleanup` available until the user edits or sends. The composer microphone remains visible when dictation is unconfigured; activating it explains that a model must be installed and links directly to the current Host's Dictation settings.

## Validation

- Protocol compatibility tests cover old Voice messages/config and new optional model/refinement capabilities and RPC schemas.
- Server tests cover no startup download, catalog validation, install/select/delete, persistence, restart recovery, active-session boundaries, refinement fail-open guards, and failure state.
- App tests cover capability gating, Host routing, model actions, refinement toggle, and unconfigured microphone guidance.
- Real production-path checks load and transcribe through both FireRed and SenseVoice using the daemon's forked Node worker.
- The same Mandarin, English, and mixed technical recordings are compared for quality, latency, and memory; automatic tests do not claim recognition quality.
- Refinement tests verify reuse of the existing structured-generation Provider path, provider/schema fail-open behavior, and the reversible draft state. A weaker-model translation failure is retained as evidence that generated cleanup is not semantically authoritative; the visible original/refined UI is the product boundary.
- Downloader tests verify the streaming byte cap independently of `Content-Length`, exact archive size, and SHA-256 validation.

## Product acceptance reopened

Real human dictation invalidated the assumption that an offline phrase recognizer plus an
amplitude gate is sufficient for live voice input. Room noise made pause detection late and
unpredictable, while FireRed still had to decode every completed phrase. Acoustic pauses also
cannot reliably express semantic sentence boundaries.

The selected replacement keeps FireRed's accepted recognition quality and simplifies the product:

- click once to start recording;
- click again to stop and transcribe;
- keep the existing draft visible and unchanged while recording;
- emit no provisional transcript, pause-derived line break, or invented punctuation;
- append one final transcript after all recognition completes.

Decoding one entire long recording only after stop is too slow: measured FireRed inference was
about 5.7 seconds for 15 seconds of audio, 11.5 seconds for 30 seconds, and 23.3 seconds for 60
seconds; the 60-second run peaked around 5 GB RSS. The daemon therefore keeps fixed-duration
background commits as an internal latency/memory optimization. Their text is hidden until stop,
and their boundaries carry no sentence semantics.

A real manager run paced 23.3 seconds of audio at live 100 ms intervals and emitted no partial
messages. Fifteen-second background commits matched the repeated fixture at 1.0 word similarity and
returned the final transcript about 1.8 seconds after stop. An eight-second boundary introduced a
spurious English token in a real 11.1-second mixed-language recording, while the fifteen-second
setting preserved the whole-buffer transcript exactly. Desktop and 390 px browser checks with the
actual FireRed model confirmed that recording preserves the draft, stop appends only the final
transcript, and cancel leaves the draft untouched.

This final-only interaction deliberately avoids adding a streaming first-pass model, VAD, or local punctuation model. SenseVoice already provides useful punctuation at much lower runtime cost; optional text-only AI refinement uses infrastructure the product already needs for Agents and remains visibly reversible to the raw ASR draft. Voice mode, TTS, barge-in, and agent speech remain removed.
