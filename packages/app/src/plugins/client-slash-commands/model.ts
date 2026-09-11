/** Client slash-command model shim (issue 025 C6).
 *
 * The plugin source is permanently empty; merging reduces to built-in plus
 * provider commands.
 */

export interface MergedSlashCommandEntry<TBuiltIn, TProvider> {
  source: "built-in" | "provider";
  command: TBuiltIn | TProvider;
}

export function mergeSlashCommandSources<TBuiltIn, TProvider>(input: {
  builtIn: readonly TBuiltIn[];
  plugins: readonly unknown[];
  provider: readonly TProvider[];
  onPluginCollision?: (command: { name: string; pluginId: string }, winner: string) => void;
}): MergedSlashCommandEntry<TBuiltIn, TProvider>[] {
  void input.plugins;
  void input.onPluginCollision;
  return [
    ...input.builtIn.map((command) => ({ source: "built-in" as const, command })),
    ...input.provider.map((command) => ({ source: "provider" as const, command })),
  ];
}
