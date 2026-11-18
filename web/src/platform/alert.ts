// Error notices that interrupt a flow (a failed provider toggle or removal, a failed daemon restart,
// a failed save). They show as an error toast: a browser alert would block the page. Every caller
// passes a notice, a title and an optional message; confirmations go through confirmDialog.
type AlertHandler = (title: string, message?: string) => void;
let alertHandler: AlertHandler | null = null;

/** The app shell routes notices into its toast (AlertToastBridge in ~/app/global-listeners). */
export function setAlertHandler(handler: AlertHandler | null): void {
  alertHandler = handler;
}

export function showAlert(title: string, message?: string): void {
  alertHandler?.(title, message);
}
