// shortcut: follows the OS only; the appearance setting (system/light/dark) arrives with the
// settings pages in step 4 of the rewrite epic.
export function followSystemColorScheme(): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
}
