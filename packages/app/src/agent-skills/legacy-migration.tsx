import type { AgentSkillSelection } from "@getpaseo/protocol/messages";

interface LegacySelectionClient {
  importLegacyAgentSkillsSelection(selection: AgentSkillSelection): Promise<unknown>;
}

// The desktop daemon store this migration read from is gone (issue 025), so
// callers must supply the read/remove pair; nothing in the app reads a legacy
// selection anymore and only the test exercises this helper.
export async function migrateLegacyAgentSkillsSelection(
  client: LegacySelectionClient,
  read: () => Promise<AgentSkillSelection | null>,
  remove: () => Promise<unknown>,
): Promise<boolean> {
  const selection = await read();
  if (!selection) return false;
  await client.importLegacyAgentSkillsSelection(selection);
  await remove();
  return true;
}
