import { AppState } from "react-native";

interface AppVisibilityInput {
  appState: string;
  documentVisible: boolean;
}

interface ActiveAppVisibilityInput extends AppVisibilityInput {
  windowFocused: boolean;
}

export function isAppVisible(input: AppVisibilityInput): boolean {
  return input.appState === "active" && input.documentVisible;
}

export function isAppActivelyVisible(input: ActiveAppVisibilityInput): boolean {
  return isAppVisible(input) && input.windowFocused;
}

function getDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function getWindowFocused(): boolean {
  return (
    typeof document === "undefined" ||
    typeof document.hasFocus !== "function" ||
    document.hasFocus()
  );
}

export function getIsAppVisible(appState: string = AppState.currentState): boolean {
  return isAppVisible({
    appState,
    documentVisible: getDocumentVisible(),
  });
}

export function getIsAppActivelyVisible(appState: string = AppState.currentState): boolean {
  return isAppActivelyVisible({
    appState,
    documentVisible: getDocumentVisible(),
    windowFocused: getWindowFocused(),
  });
}
