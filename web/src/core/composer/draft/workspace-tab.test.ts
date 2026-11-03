import { describe, expect, test } from "vitest";

import {
  buildDraftInitialValues,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("buildDraftInitialValues", () => {
  test("returns undefined when neither initialSetup nor defaultRole is given", () => {
    expect(buildDraftInitialValues({ initialSetup: null })).toBeUndefined();
  });

  test("seeds the Chief role when defaultRole is provided for the Home workspace", () => {
    expect(buildDraftInitialValues({ initialSetup: null, defaultRole: "chief" })).toEqual({
      provider: undefined,
      modeId: undefined,
      model: undefined,
      thinkingOptionId: undefined,
      role: "chief",
    });
  });

  test("lets an explicit initialSetup role win over defaultRole", () => {
    expect(
      buildDraftInitialValues({
        initialSetup: {
          cwd: "/tmp",
          provider: "pi",
          modeId: null,
          model: null,
          thinkingOptionId: null,
          featureValues: {},
          role: "researcher",
        },
        defaultRole: "chief",
      }),
    ).toMatchObject({ role: "researcher" });
  });
});
