/** Client slash-command plugin source shim (issue 025 C6). */
export interface PluginClientSlashCommand {
  id: string;
  name: string;
  label: string;
  pluginId: string;
  description?: string;
  [key: string]: unknown;
}

export function usePluginSlashCommands(): [] {
  return [];
}
