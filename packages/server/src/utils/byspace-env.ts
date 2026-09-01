// COMPAT(byspaceEnvironment): legacy PASEO_* aliases are required for existing
// integrations. Added after v0.7.0-beta.2; remove only in a documented major release.
export function withByspaceEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...env };

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("BYSPACE_") || value === undefined) continue;
    resolved[`PASEO_${name.slice("BYSPACE_".length)}`] = value;
  }

  return resolved;
}
