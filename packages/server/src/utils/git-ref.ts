const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function assertSafeGitRef(ref: string, label: string): void {
  if (
    !SAFE_GIT_REF_PATTERN.test(ref) ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("@{")
  ) {
    throw new Error(`Invalid ${label}: ${ref}`);
  }
}
