/** Accept bare `user@host`, scp-style `host:2222`, or full `ssh://` URIs. */
export function normalizeSshTargetInput(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("ssh://")) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    // Some other scheme — leave it so the parser reports it.
    return trimmed;
  }
  return `ssh://${trimmed}`;
}
