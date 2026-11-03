import { expect, type Page } from "@playwright/test";

export async function waitForQuestionPrompt(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId("question-form-card").first()).toBeVisible({ timeout });
}

export async function expectCurrentQuestion(
  page: Page,
  input: { index: number; total: number; question: string },
): Promise<void> {
  const card = page.getByTestId("question-form-card").first();
  // shadcn's Questionnaire keeps every question mounted and hides the inactive ones.
  await expect(
    card.getByTestId("question-form-current-question").filter({ visible: true }),
  ).toHaveText(input.question);
  // The progress line only renders for multi-question cards.
  if (input.total > 1) {
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      `Question ${input.index} of ${input.total}`,
    );
  }
}

export async function expectQuestionHidden(page: Page, question: string): Promise<void> {
  await expect(page.getByText(question, { exact: true }).filter({ visible: true })).toHaveCount(0);
}

// Options render as radios (single-select) or checkboxes (multi-select), so match
// either role by accessible name.
function questionOption(page: Page, option: string) {
  const card = page.getByTestId("question-form-card").first();
  return card.getByRole("radio", { name: option }).or(card.getByRole("checkbox", { name: option }));
}

export async function chooseQuestionOption(page: Page, option: string): Promise<void> {
  await questionOption(page, option).click();
}

export async function expectQuestionOptionSelected(page: Page, option: string): Promise<void> {
  await expect(questionOption(page, option)).toBeChecked();
}

export async function goToPreviousQuestion(page: Page): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("button", { name: "Previous" })
    .click();
}

/** Submitting with the current question unanswered keeps the card and says why. */
export async function expectSubmitAsksForAnswer(page: Page): Promise<void> {
  const card = page.getByTestId("question-form-card").first();
  await card.getByRole("button", { name: "Submit" }).click();
  await expect(
    card.getByText("Choose an answer to continue.").filter({ visible: true }),
  ).toBeVisible();
  await expect(card).toBeVisible();
}

export async function fillQuestionAnswer(
  page: Page,
  input: { question: string; answer: string },
): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("textbox", { name: input.question })
    .fill(input.answer);
}

export async function submitQuestionAnswers(page: Page): Promise<void> {
  await page.getByTestId("question-form-primary-action").filter({ visible: true }).click();
  await expect(page.getByTestId("question-form-card")).toHaveCount(0, { timeout: 30_000 });
}

export async function expectQuestionPrimaryActionEnabled(page: Page, label: string): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: label }),
  ).toBeEnabled();
}

export async function expectQuestionDismissEnabled(page: Page): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: "Dismiss" }),
  ).toBeEnabled();
}

export async function continueToNextQuestion(page: Page): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("button", { name: "Next" })
    .click();
}
