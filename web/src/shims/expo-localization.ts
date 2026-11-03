// Stand-in for `expo-localization`, backed by navigator.languages.
export function getLocales(): Array<{ languageTag: string }> {
  return navigator.languages.map((languageTag) => ({ languageTag }));
}
