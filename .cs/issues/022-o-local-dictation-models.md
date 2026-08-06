---
status: pending
priority: high
created: 2026-08-04
closed: null
---

# Local dictation model management

## Why

BySpace only needs speech-to-text, but currently ships an unusable Voice mode and silently downloads an English-first default model. Users cannot choose a high-quality Mandarin/English model or understand why dictation is unavailable.

## Source

- Talk: `.cs/talks/003-local-dictation-models.md`
- Existing speech truth: `.cs/spec/index.md` (`Architecture #632`, to be replaced on close)

## Goal

Make dictation the only speech feature and require an explicit Host-local model installation/selection before it can run.

## Product acceptance finding

Human testing withdrew the earlier acceptance of phrase-level live preview. FireRed AED is
an offline recognizer; closing phrases with a fixed PCM peak threshold produced neither true
incremental text nor reliable endpointing in real room noise. Tuning that threshold was rejected.

The selected product contract is now explicit start/stop dictation with one final transcript:

- The user clicks once to record and clicks again to stop and transcribe.
- Recording never changes the draft or emits provisional text.
- Stopping produces one final transcript and appends it to the visible draft for review.
- No acoustic pause is presented as punctuation or a semantic sentence boundary.
- To avoid decoding an entire long recording after stop, the daemon may precompute fixed-duration
  internal chunks while recording. Those boundaries are implementation details: they produce no
  partial UI, newline, punctuation, or automatic submission.

A real FireRed benchmark explains that internal optimization: whole-buffer decoding took about
5.7 seconds for 15 seconds of audio, 11.5 seconds for 30 seconds, and 23.3 seconds for 60
seconds, with the 60-second process peaking around 5 GB RSS. Fixed-duration background commits
bound stop latency and memory while preserving final-only product semantics.

The completed mechanics below are not product acceptance. Human testing of the simplified
start/stop flow remains the release blocker.

## Contract

### Model catalog

- The daemon exposes two allowlisted local STT choices: FireRedASR2-AED ONNX int8 for Mandarin-first quality, and SenseVoice Small ONNX int8 for a much smaller/faster multilingual option with built-in punctuation.
- SenseVoice is downloaded only on explicit user action, retains its bundled FunASR Model License file, and is attributed to Alibaba FunASR in the catalog and public documentation.
- Qwen3-ASR 0.6B is deferred: sherpa-onnx publishes the model, but its latest stable Node binding does not expose the Qwen3 recognizer configuration required by the daemon.
- Catalog IDs are allowlisted and validated again for every operation.
- Model metadata includes display label, language/quality description, download size, runtime status, and optional error.
- No arbitrary URL/model path, Python runtime, CUDA requirement, or cloud provider is accepted.
- sherpa-onnx Node is pinned to 1.13.4: 1.12.28 fails the real FireRed worker path because it does not export a constructible `OfflineRecognizer`.

### Lifecycle

- No model is selected by default.
- Daemon startup never starts a model download.
- Install is explicit, backgrounded, idempotent, staged, and validated before becoming ready.
- A successful install may activate the model; selecting an already-ready model is immediate.
- Selection is persisted per Host and takes effect for the next dictation session.
- Deletion cannot remove a model in use; deleting the selected model clears selection.
- Existing model files are never silently removed.

- FireRed and SenseVoice remain offline recognizers; the product does not claim streaming or live preview.
- Recording continues until explicit cancel or stop. Acoustic pauses do not trigger commits.
- The daemon performs fixed-duration background commits only to bound final latency and memory. FireRed uses 15 seconds; SenseVoice uses 30 seconds because whole-buffer decoding is substantially faster and lighter, reducing quality loss at invisible hard boundaries.
- Internal commit boundaries are joined as continuous text; they never invent newlines or punctuation.
- Silence-only input is cleared rather than sent to the recognizer.
- No `dictation_stream_partial` messages are emitted by the runtime path.
- Stop waits for every background segment and the final tail, then emits one ordered final transcript.
- FireRed follows the official AED post-processing; SenseVoice removes its language/emotion/event control tokens while preserving model punctuation.

### Optional AI refinement

- AI refinement is an explicit Host setting and defaults off.
- When enabled, only the final transcript text—not audio—is sent through the same structured-generation provider resolution and non-persisted internal Agent path used for titles, commit messages, and PR text.
- It therefore supports the same Provider set instead of adding a dictation-only adapter.
- Provider or schema failure returns the original transcript. A successful result is labeled as AI-cleaned in the composer, keeps both original and refined drafts behind a direct toggle until the user edits or sends, and is never automatically sent.
- Download responses are stream-capped at the catalog size before archive verification, so a malformed overlong response cannot consume unbounded Host disk.

### Protocol

- `server_info.features.speechModelSelection` gates local model management; `server_info.features.dictationRefinement` gates optional AI cleanup.
- Dotted RPCs cover model list/download/select/delete and transcript refinement.
- New schemas and fields are optional/backward compatible.
- Old Voice mode inbound/outbound schemas remain accepted. Enabling it returns a deterministic unsupported response.
- Removed persisted Voice mode configuration remains accepted and ignored behind a dated `COMPAT` shim.

### App

- Host settings add a compact Dictation section using the shared settings rows.
- The section shows each model's purpose, size, state, and only the actions install/use, switch, and delete.
- A separate `Refine with AI` switch defaults off and discloses the text-only extra model call plus the reversible original/refined draft behavior.
- Download state is refreshed while a job is active.
- The microphone remains visible while unconfigured; activating it explains the requirement and opens that Host's Dictation settings.
- While recording, the composer keeps the existing draft visible and unchanged.
- Recording controls replace only the composer toolbar: cancel, volume/duration, and stop/transcribe.
- After stop, the toolbar shows processing, then appends raw fail-open text or a labeled AI-cleaned draft with `Use original` / `Use AI cleanup` toggling.
- The same stacked composer structure is retained on desktop and compact browser layouts:

```text
┌─ Composer ────────────────────────────────────────┐
│ Existing draft remains unchanged while recording │
│ [Cancel]          [meter · 00:04]          [Stop] │
└──────────────────────────────────────────────────┘
```

- No Voice mode button, shortcut, full-input recording overlay, playback diagnostics, or Voice runtime remains.

## Out of scope

- TTS, voice conversations, VAD, barge-in, voice agent prompt changes
- Cloud/API speech providers
- Arbitrary user-supplied models
- GPU-specific acceleration
- Automatic language selection across separate models
- Claiming model quality from vendor benchmarks alone
- Token-by-token live decoding from an offline phrase model
- FireRedPunc punctuation/case restoration; adding it requires a separate local model and runtime path.

## Verification

- [x] Protocol wire compatibility and generated validation pass.
- [x] No selected model means no startup download and dictation unavailable.
- [x] Install/select/delete persistence and runtime switching pass focused server tests.
- [x] Unknown model IDs and unsafe deletion are rejected.
- [x] Old Voice mode requests receive a stable unsupported response.
- [x] Host settings and unconfigured composer guidance pass focused app/E2E tests.
- [x] Typecheck, lint, format check, and Web export pass.
- [x] Real FireRed worker loading and PCM transcription pass through the packaged Node binding.
- [x] Mandarin, English, and mixed synthetic recordings were evaluated on FireRedASR2-AED.
- [x] SenseVoice Small loads through the production sherpa Node worker and transcribes the real PCM fixture.
- [x] AI refinement directly reuses the title/commit/PR structured-generation path, supports the same Providers, fails open to raw text, and keeps both original and refined drafts behind a composer toggle.
- [x] Independent correctness review has no unresolved high/medium findings.
- [x] Natural pauses do not commit, emit partial text, or create line breaks.
- [x] Fixed-duration background commits assemble in causal order and final output emits only after stop.
- [x] Cancel discards the recording; stop appends only the final transcript to the existing draft.
- [x] Desktop and compact browser layouts keep the composer text visible while recording.
- [ ] Human voice-input acceptance of the explicit start/stop, final-only flow.

- Base focused server lifecycle/downloader/worker tests: 21 passed.
- Final-only dictation stream manager tests: 12 passed, including silence, causal ordering, background-commit races, repeated finish, cancel-during-debug-persistence, and no-partial behavior.
- Real daemon-client dictation tests: 3 passed for FireRed PCM transcription, baseline similarity, and missing-chunk failure.
- FireRed provider tests: 5 passed for segment sequencing, control-token removal, official AED lowercase output, quiet nonzero PCM, and all-zero PCM.
- Real FireRed worker process test passed with the packaged sherpa-onnx 1.13.4 binding; a mixed-language fixture scaled to PCM peak 299 also transcribed successfully instead of being discarded as silence.
- Final-only app tests: composer state 20 passed, stream sender 5 passed, and i18n resources 29 passed; the hook/control integration and Dictation settings passed real-browser checks.
- Manual real-browser verification used the actual FireRed model: desktop and 390px compact composers kept the draft visible, stop inserted only the final transcript, and cancel preserved the original draft.
- A 23.3-second real-time-paced FireRed manager run emitted no partials, matched the repeated fixture at 1.0 word similarity, and returned the final transcript about 1.8 seconds after stop. Fifteen-second internal commits also preserved a real 11.1-second mixed-language whole-buffer transcript exactly; an eight-second boundary had introduced a spurious token.
- SenseVoice benchmark: ~163 MB archive; 11.5 seconds of audio decoded in ~0.5 seconds at ~0.95 GB peak RSS versus FireRed at ~4.2 seconds and ~4.0 GB. A 60-second whole-buffer run decoded in ~1.7 seconds at ~1.18 GB; the production path uses a 30-second invisible cap to reduce hard-boundary count while bounding long-input behavior.
- Real SenseVoice production path: the CLI transcribed the PCM fixture as `This is a voice note.` in 0.66 seconds; the forked worker-process test passed in 0.51 seconds.
- Same-fixture comparison: SenseVoice matched or exceeded FireRed on the Mandarin and English fixtures and preserved more of one mixed command, but occasionally fused technical English tokens. Optional AI refinement can repair these, while the composer retains the raw ASR text for immediate comparison or restoration.
- Real internal-Agent prototypes confirmed structured generation can restore punctuation and token spacing. One weaker-model run translated an English span; this is retained as evidence that prompt compliance and heuristic validation are insufficient without the visible original/refined toggle.
- Protocol validation tests, model/refinement tests, client correlation tests, and Dictation settings Playwright acceptance passed.
- Root typecheck, lint, format check, server build, and Web export passed.
- Final independent review found no unresolved High/Medium correctness or data-loss issue after replacing the Claude-only adapter with the existing all-Provider structured-generation path and retaining the stream-size cap.
- Synthetic quality smoke outputs:
  - English: `please run the type check and rebuild the server before opening the pull`
  - Mandarin: `今天我们修复了终端粘贴和工作区切换的问题请重新运行类型检查`
  - Mixed: `请先运行 npm run type check然后检查 websocket connection和 terminal snapshot是否正常`
- Human-voice product acceptance is a release blocker. The rejected peak-threshold preview path has been removed; the explicit start/stop final-only flow still requires acceptance.
