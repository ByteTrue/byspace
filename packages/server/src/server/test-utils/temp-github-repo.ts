// Single namespace for temporary GitHub repos created by BySpace tests.
// Bulk cleanup relies on this prefix being unmistakable — never reuse `byspace-`
// (collides with real repos like `byspace`, `byspace-website`).
export const TEMP_GITHUB_REPO_PREFIX = "byspacetmp-";

export function createTempGithubRepoName(category: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${TEMP_GITHUB_REPO_PREFIX}${category}-${Date.now()}-${rand}`;
}
