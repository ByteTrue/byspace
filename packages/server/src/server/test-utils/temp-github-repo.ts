import { execFileSync } from "node:child_process";

// Single namespace for temporary GitHub repos created by BySpace tests.
// Bulk cleanup relies on this prefix being unmistakable — never reuse `byspace-`
// (collides with real repos like `byspace`, `byspace-website`).
export const TEMP_GITHUB_REPO_PREFIX = "byspacetmp-";

export function createTempGithubRepoName(category: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${TEMP_GITHUB_REPO_PREFIX}${category}-${Date.now()}-${rand}`;
}

/**
 * True when this machine can run a test that creates a temporary GitHub repo.
 *
 * A test that creates a repo must delete it, and `gh repo delete` needs the
 * token's `delete_repo` scope. Gate on the scope rather than on `gh auth status`
 * alone: with auth but no scope the test runs, the delete 403s inside the
 * cleanup's `try/catch`, and the repo leaks silently. Leaked repos accumulate
 * until GitHub answers the next create with "You have created too many
 * repositories, too quickly" — a failure that reads like a fixture bug and is
 * not one.
 *
 * This lived as four copies across the e2e tests; two were wrong. Call it from
 * one place so the next fix lands everywhere.
 *
 * The app suite has the same gate as `canCreateGithubFixtures()`
 * (`packages/app/e2e/support/helpers/github-fixtures.ts`). The app does not
 * depend on the server package, so the two are copies: fix both.
 */
export function canCreateTempGithubRepos(): boolean {
  try {
    const status = execFileSync("gh", ["auth", "status", "-h", "github.com"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    const scopesLine = status.split(/\r?\n/).find((line) => /token[- ]scopes?:/i.test(line));
    return scopesLine?.includes("delete_repo") ?? false;
  } catch {
    return false;
  }
}
