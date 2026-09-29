/**
 * The built-in roster seed: the eight role rows become assignable
 * teammates at first boot, exactly the shape the secretary's own seed set.
 * Idempotent by system_key, so a console rename never breaks re-seeding
 * and the roster survives every restart.
 */
import type { MulticaStore } from "./store.js";
import { builtinRoleInstructions, listBuiltinRoles } from "./builtin-roles.js";

/**
 * Seed every built-in role that has no row yet. Returns how many agents
 * were created, so the boot log can say what happened. A role row is an
 * ordinary assignable teammate (kind user), not a hidden carrier: the
 * secretary dispatches work to "Frontend Developer" by assigning an issue,
 * so the role must sit in the same picker as any agent.
 */
export function seedBuiltinRoster(store: MulticaStore): number {
  let created = 0;
  for (const role of listBuiltinRoles()) {
    if (store.findAgentBySystemKey(role.key)) {
      continue;
    }
    const agent = store.createAgent({
      name: role.name,
      description: role.description,
      instructions: builtinRoleInstructions(role),
      systemKey: role.key,
    });
    for (const skill of role.skills) {
      const skillId = store.seedBuiltinSkill(skill.name, skill.description, skill.files);
      store.linkAgentSkill(agent.id, skillId);
    }
    created += 1;
  }
  return created;
}
