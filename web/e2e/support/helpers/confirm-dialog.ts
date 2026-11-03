import type { Page } from "@playwright/test";

/** The part of Playwright's Dialog the specs use. */
export interface ConfirmPrompt {
  type(): string;
  message(): string;
  accept(): Promise<void>;
  dismiss(): Promise<void>;
}

/**
 * The next confirmation (the confirm-dialog AlertDialog), answered by the caller. Its message is
 * "title\n\nmessage", as a window.confirm prompt's was.
 */
export async function waitForConfirm(page: Page, timeout = 60_000): Promise<ConfirmPrompt> {
  const root = page.getByTestId("confirm-dialog");
  await root.waitFor({ state: "visible", timeout });
  const title = await root.locator('[data-slot="alert-dialog-title"]').innerText();
  const body = await root.locator('[data-slot="alert-dialog-description"]').innerText();
  const message = `${title}\n\n${body}`;
  return {
    type: () => "confirm",
    message: () => message,
    accept: () => root.getByTestId("confirm-dialog-confirm").click(),
    dismiss: () => root.getByTestId("confirm-dialog-cancel").click(),
  };
}

/**
 * `page.once("dialog", handler)` for either frontend; a confirmation that never comes is ignored.
 * Await the result before reading what the handler saw: window.confirm blocks the click that
 * opened it until it is answered, web/'s dialog does not.
 */
export function onceConfirm(
  page: Page,
  handler: (prompt: ConfirmPrompt) => unknown,
): Promise<void> {
  return waitForConfirm(page).then(
    async (prompt) => {
      await handler(prompt);
      return undefined;
    },
    () => undefined,
  );
}
