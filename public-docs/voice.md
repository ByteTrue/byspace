---
title: Dictation
description: Local speech-to-text model setup and operation.
nav: Dictation
order: 41
category: Configuration
---

# Dictation

BySpace supports local speech-to-text dictation. It does not provide Voice mode, text-to-speech, or cloud speech providers.

## Set up a Host

Dictation models belong to the Host running the daemon. Each Host is configured independently.

1. Open **Host Settings** for the Host you want to use.
2. Open **Dictation**.
3. Choose **Download and use** for a model.
4. Wait for the model to finish downloading and become **In use**.

BySpace does not download a model by default. Until you complete these steps, the microphone remains visible but opens the Dictation settings instead of recording.

## Model catalog

The catalog contains two CPU models:

- `sensevoice-small-int8` (SenseVoice Small ONNX int8) is the smaller/faster option. It supports Mandarin, English, Cantonese, Japanese, and Korean and includes punctuation. The download is about 155 MiB. SenseVoice is provided by Alibaba FunASR under its bundled FunASR Model License.
- `fire-red-asr2-aed-int8` (FireRedASR2-AED ONNX int8) is the Mandarin-first quality option, with English, Chinese dialects, and Chinese-English code-switching support. The download is about 800 MiB.

Only the selected model is loaded. Models are downloaded from the fixed BySpace catalog, verified by exact size and SHA-256 checksum, and installed under `$BYSPACE_HOME/models/local-speech` unless you override the model directory. Arbitrary model URLs are not accepted.

## Manage a model

The Dictation settings show the selected model and its current state:

- **Download and use** installs and selects a model.
- **Use** switches to an already installed model.
- **Delete** removes the model from that Host. Deleting the active model returns dictation to the unconfigured state.
- **Retry** retries a failed download.

A model change never interrupts an active dictation session. Finish the current session before switching or deleting its model.

## Use dictation

Select the microphone in the composer to start recording. The existing draft remains visible and cannot be edited while recording. Select **Stop and transcribe** when you finish speaking; BySpace then appends one final transcript to the draft for review.

The recording toolbar also provides **Cancel**, which discards the recording without changing the draft. Dictation does not stream provisional text, infer sentence breaks from pauses, or send automatically.

## Optional AI refinement

Turn on **Clean up with AI** in the Host's Dictation settings to clean up the final transcript through the same structured-generation Provider path used for titles and Git metadata. This optional setting defaults off. It can restore punctuation and paragraphs, remove obvious filler or repetition, and repair an unambiguous recognition typo. It creates one extra model call.

Audio remains on the Host; only transcript text is sent through the same structured-generation provider path used for titles and Git metadata. Provider failures fail open to the original transcript.

A successful result appears in the composer as an **AI-cleaned transcript**, never sends automatically, and keeps a **Use original** toggle so you can compare or restore the raw ASR text.

## Advanced environment overrides

The Host settings are the normal configuration path. These environment variables are available for controlled deployments:

- `BYSPACE_LOCAL_MODELS_DIR`: override the Host-local model directory.
- `BYSPACE_DICTATION_LOCAL_STT_MODEL`: override the selected catalog model ID.

The legacy `features.voiceMode` configuration is accepted only for backward-compatible config parsing and has no runtime effect.
