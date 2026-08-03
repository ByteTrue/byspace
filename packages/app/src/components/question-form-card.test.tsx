/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: [0, 4, 8, 12, 16],
    borderWidth: { 1: 1 },
    borderRadius: { base: 4, md: 6, lg: 8 },
    fontSize: { sm: 13, base: 15 },
    fontWeight: { medium: "500", semibold: "600" },
    colors: {
      foreground: "#111",
      foregroundMuted: "#666",
      surface1: "#fff",
      surface2: "#f4f4f5",
      border: "#ddd",
      borderAccent: "#06c",
      accent: "#06c",
      accentForeground: "#fff",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (value: typeof theme) => unknown)(theme)
        : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span data-testid="loading-spinner" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "common.actions.dismiss": "Dismiss",
        "message.question.answerPlaceholder": "Answer",
        "message.question.otherPlaceholder": "Other...",
        "message.question.submit": "Submit",
        "message.question.next": "Next",
      })[key] ?? key,
  }),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { QuestionFormCard } from "./question-form-card";

const permission = {
  request: {
    id: "question-1",
    provider: "pi",
    name: "Pi ask_user_question",
    kind: "question",
    input: {
      questions: [
        {
          question: "Pick or type",
          header: "Answer",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
          allowOther: true,
        },
      ],
    },
  },
} as never;

afterEach(() => {
  cleanup();
});

describe("QuestionFormCard", () => {
  it("uses the latest text from Return even when input state has not committed", () => {
    const onRespond = vi.fn();
    render(<QuestionFormCard permission={permission} onRespond={onRespond} isResponding={false} />);

    const input = screen.getByRole("textbox");
    Object.defineProperty(input, "value", { configurable: true, value: "fresh answer" });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onRespond).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "allow",
        updatedInput: expect.objectContaining({
          answers: { Answer: "fresh answer" },
        }),
      }),
    );
  });
});
