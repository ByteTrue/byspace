// COMPAT(byspaceEnvironment): command internals still consume PASEO_* names.
// Added after v0.7.0-beta.2; remove only in a documented major release.
export function applyByspaceEnvironment(env: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("BYSPACE_") || value === undefined) continue;
    env[`PASEO_${name.slice("BYSPACE_".length)}`] = value;
  }
}
