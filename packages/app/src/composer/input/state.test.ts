import { describe, expect, it } from "vitest";
import {
  appendDictationTranscript,
  applyDictationRefinement,
  computeCanStartDictation,
  runAlternateSendAction,
  runDefaultSendAction,
  runMessageInputKeyboardAction,
  toggleDictationRefinement,
} from "./state";

const connected = { isConnected: true } as never;
const disconnected = { isConnected: false } as never;

function createDictationKeyboard({ startsRecording }: { startsRecording: boolean }) {
  let isRecording = false;
  const actions: string[] = [];

  return {
    actions,
    pressDictationShortcut: () =>
      runMessageInputKeyboardAction("dictation-toggle", {
        focusInput: () => undefined,
        isDictationRecording: () => isRecording,
        isDictationActive: () => isRecording,
        startDictation: () => {
          actions.push("start");
          isRecording = startsRecording;
        },
        confirmDictation: () => {
          actions.push("confirm");
          isRecording = false;
        },
        cancelDictation: () => undefined,
      }),
  };
}

describe("appendDictationTranscript", () => {
  it("appends final text to an empty draft", () => {
    expect(appendDictationTranscript("", "hello world")).toBe("hello world");
  });

  it("separates final text from an existing draft", () => {
    expect(appendDictationTranscript("Existing draft", "hello world")).toBe(
      "Existing draft hello world",
    );
  });

  it("preserves line breaks returned by the final transcript", () => {
    expect(appendDictationTranscript("Existing draft", "第一件事\nsecond task")).toBe(
      "Existing draft 第一件事\nsecond task",
    );
  });

  it("keeps Mandarin text and punctuation adjacent", () => {
    expect(appendDictationTranscript("你好", "世界")).toBe("你好世界");
    expect(appendDictationTranscript("你好", "，世界")).toBe("你好，世界");
    expect(appendDictationTranscript("你好", "“世界”")).toBe("你好“世界”");
    expect(appendDictationTranscript("hello", "世界")).toBe("hello 世界");
  });

  it("returns the original draft when the final transcript is empty", () => {
    expect(appendDictationTranscript("Existing draft", "")).toBe("Existing draft");
  });
});

describe("dictation refinement choice", () => {
  it("defaults to the AI draft and toggles losslessly to the original", () => {
    const applied = applyDictationRefinement("existing draft", "cleaned transcript", {
      requestId: "refine-1",
      originalText: "raw transcript",
    });
    expect(applied).toEqual({
      draft: "existing draft cleaned transcript",
      choice: {
        originalDraft: "existing draft raw transcript",
        refinedDraft: "existing draft cleaned transcript",
        showingOriginal: false,
      },
    });

    const original = toggleDictationRefinement(applied.draft, applied.choice!);
    expect(original.draft).toBe("existing draft raw transcript");
    expect(original.choice?.showingOriginal).toBe(true);

    const refined = toggleDictationRefinement(original.draft, original.choice!);
    expect(refined.draft).toBe("existing draft cleaned transcript");
    expect(refined.choice?.showingOriginal).toBe(false);
  });

  it("clears a stale comparison without replacing a manual edit", () => {
    const applied = applyDictationRefinement("draft", "cleaned", {
      requestId: "refine-2",
      originalText: "raw",
    });
    expect(toggleDictationRefinement("manually edited", applied.choice!)).toEqual({
      draft: "manually edited",
      choice: null,
    });
  });

  it("uses the raw transcript when refinement did not run", () => {
    expect(
      applyDictationRefinement("draft", "raw", {
        requestId: "refine-3",
      }),
    ).toEqual({ draft: "draft raw", choice: null });
  });
});

describe("computeCanStartDictation", () => {
  it("returns false when socket is disconnected", () => {
    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when isReadyForDictation is explicitly false", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: false,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns true when connected and ready", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);
  });

  it("falls back to socket connected state when isReadyForDictation is undefined", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);

    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when the input is disabled", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: true,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when a dictation unavailable message is present", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: "Microphone unavailable",
      }),
    ).toBe(false);
  });

  it("returns false when client is null", () => {
    expect(
      computeCanStartDictation({
        client: null,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });
});

describe("dictation keyboard behavior", () => {
  it("starts dictation again after the previous dictation finishes", () => {
    const keyboard = createDictationKeyboard({ startsRecording: true });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "confirm", "start"]);
  });

  it("can retry when starting dictation does not enter the recording state", () => {
    const keyboard = createDictationKeyboard({ startsRecording: false });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "start"]);
  });

  it("owns the cancel shortcut while transcription or refinement is processing", () => {
    const calls: string[] = [];
    const handled = runMessageInputKeyboardAction("dictation-cancel", {
      focusInput: () => undefined,
      isDictationRecording: () => false,
      isDictationActive: () => true,
      startDictation: () => {
        calls.push("start");
      },
      confirmDictation: () => {
        calls.push("confirm");
      },
      cancelDictation: () => {
        calls.push("cancel");
      },
    });

    expect(handled).toBe(true);
    expect(calls).toEqual(["cancel"]);
  });
});

describe("composer send behavior", () => {
  function actions() {
    const calls: string[] = [];
    return {
      calls,
      handleSendMessage: () => calls.push("send"),
      handleQueueMessage: () => calls.push("queue"),
      onQueue: () => undefined,
    };
  }

  it("uses Enter to interrupt and Mod+Enter to queue when interrupt is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["send"]);
    expect(alternateAction.calls).toEqual(["queue"]);
  });

  it("uses Enter to queue and Mod+Enter to submit when queue is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["queue"]);
    expect(alternateAction.calls).toEqual(["send"]);
  });
});
