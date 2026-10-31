// Transitional stand-in for `expo-localization`, backed by navigator.languages. Deleted at the cutover.
export function getLocales(): Array<{ languageTag: string }> {
  return navigator.languages.map((languageTag) => ({ languageTag }));
}
