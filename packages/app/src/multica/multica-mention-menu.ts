/**
 * The composer's mention menu, as pure string rules: when the draft's tail
 * is an open mention (`@` plus a name fragment, at the end of the text),
 * which candidates match, and what the draft becomes when one is chosen.
 *
 * Tail-only by design for v1: the text input's handle exposes a write face
 * (replaceText) but no cursor read, so a mid-text trigger would need the
 * component to grow a selection surface. A mention typed at the tail is the
 * case the menu exists for; a mid-text `@` stays a literal character.
 */
export interface MentionCandidate {
  readonly kind: "agent" | "squad";
  readonly id: string;
  readonly name: string;
}

export interface MentionMenuState {
  /** The fragment typed after the @, empty when the @ is bare. */
  readonly fragment: string;
  readonly candidates: readonly MentionCandidate[];
}

const TAIL_MENTION = /@([\p{L}\p{N}_-]*)$/u;

/** The open mention at the draft's tail, or null when there is none. */
export function tailMention(draft: string): string | null {
  const match = TAIL_MENTION.exec(draft);
  return match ? match[1] : null;
}

export function mentionMenuState(
  draft: string,
  roster: {
    readonly agents: readonly MentionCandidate[];
    readonly squads: readonly MentionCandidate[];
  },
): MentionMenuState | null {
  const fragment = tailMention(draft);
  if (fragment === null) {
    return null;
  }
  const lowered = fragment.toLowerCase();
  const candidates = [...roster.agents, ...roster.squads].filter((candidate) =>
    candidate.name.toLowerCase().startsWith(lowered),
  );
  return { fragment, candidates };
}

/**
 * The draft after choosing a candidate: the tail's @fragment becomes the
 * source's markup, carrying the target's id so the name never has to be
 * re-resolved and a multi-word name never truncates.
 */
export function applyMentionChoice(draft: string, choice: MentionCandidate): string {
  const fragment = tailMention(draft);
  if (fragment === null) {
    return draft;
  }
  const head = draft.slice(0, draft.length - fragment.length - 1);
  return `${head}[@${choice.name}](mention://${choice.kind}/${choice.id}) `;
}
