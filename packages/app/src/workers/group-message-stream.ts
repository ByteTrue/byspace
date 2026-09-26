import type { WorkerMessageSummary } from "@bytetrue/protocol/worker/rpc-schemas";

/**
 * Turning a group's messages into what the console draws.
 *
 * Pure and separate from the renderer so the rules the reference product states
 * about its message stream are asserted once, here, rather than being
 * rediscovered in JSX.
 *
 * Three of those rules decide what a reader sees, and none of them are obvious
 * from the field names:
 *
 * - A structured audience is what routes. Body text containing `@name` is
 *   presentation only and never populates it, so a rendered mention set has to
 *   come from the field and not from the text.
 * - Visibility and waking are different facts. An omitted private set means the
 *   message is public *even when it mentions exactly one worker*, so "only Bob
 *   can see this" must never be inferred from a single addressee.
 * - The console is the operator view, which reads everything including a
 *   private exchange it is not a party to. Showing those is deliberate, but a
 *   private one is labelled, because an unlabelled private message in a public
 *   log reads as a leak.
 */

export interface MessageActor {
  id: string;
  name: string;
}

export interface DisplayMessage {
  messageId: string;
  seq: number;
  body: string;
  createdAt: string;
  sender: MessageActor;
  /** Addressed workers, from the structured field. Empty when nobody is. */
  audience: MessageActor[];
  /** Waking or merely recorded. Drives the "woke nobody" note below. */
  wakes: boolean;
  /** Narrower than the group. The console still shows it, labelled. */
  isPrivate: boolean;
  /**
   * Everyone who may read it, sender included.
   *
   * The stored private set lists the *other* readers — the sender can always
   * read their own message — so a private set of one means two people may see
   * it. Reading that set as the whole audience would report a message between
   * two workers as visible to only one of them.
   */
  readers: MessageActor[];
  /** Display classification, carried through unchanged: it never routes. */
  intent: string;
  /** The message this quotes, when the send named one. */
  replyToSeq: number | null;
}

/** A group's stream, oldest first, which is how a conversation is read. */
export function buildMessageStream(
  messages: readonly WorkerMessageSummary[],
  namesByWorkerId: ReadonlyMap<string, string>,
): DisplayMessage[] {
  const seqById = new Map(messages.map((message) => [message.messageId, message.seq]));

  return messages.map((message) => ({
    messageId: message.messageId,
    seq: message.seq,
    body: message.body,
    createdAt: message.createdAt,
    sender: actor(message.senderWorkerId, namesByWorkerId),
    audience: message.audience.map((workerId) => actor(workerId, namesByWorkerId)),
    wakes: message.deliveryPolicy === "wake",
    isPrivate: message.privateTo.length > 0,
    readers: [...new Set([message.senderWorkerId, ...message.privateTo])].map((workerId) =>
      actor(workerId, namesByWorkerId),
    ),
    intent: message.intent,
    // Resolved to the visible number rather than the id: a reader follows the
    // stream by its sequence, and an opaque id is not something they can locate.
    replyToSeq:
      message.replyToMessageId === null ? null : (seqById.get(message.replyToMessageId) ?? null),
  }));
}

function actor(workerId: string, names: ReadonlyMap<string, string>): MessageActor {
  // The id is the fallback rather than a guess at a name: a worker the host no
  // longer ships is still the one that spoke.
  return { id: workerId, name: names.get(workerId) ?? workerId };
}

/**
 * What a message did, in one clause.
 *
 * Derived rather than stored, and worded so the three cases a reader can
 * otherwise confuse stay distinct: nobody was woken, some specific workers were,
 * or it woke its whole audience. A waking send that addressed nobody is its own
 * case — that is a message nobody was called to answer, which looks identical to
 * a stored one unless it is said.
 */
export function describeDelivery(message: DisplayMessage): string {
  if (!message.wakes) {
    return message.audience.length > 0
      ? "visible but woke nobody"
      : "recorded without waking anyone";
  }
  if (message.audience.length === 0) {
    return "marked to wake, nobody addressed";
  }
  const names = message.audience.map((entry) => entry.name);
  if (names.length === 1) {
    return `woke ${names[0]}`;
  }
  return `woke ${names.length} workers`;
}

/** A visibility clause, or null when there is nothing to say about it. */
export function describeVisibility(message: DisplayMessage): string | null {
  if (!message.isPrivate) return null;
  // The line is about who else may see this, so the sender is named only when
  // they are genuinely the only reader: a message between two workers must not
  // read as one person's private note.
  const others = message.readers.filter((entry) => entry.id !== message.sender.id);
  if (others.length === 0) {
    return "private to the sender only";
  }
  if (others.length === 1) {
    return `private between ${message.sender.name} and ${others[0]!.name}`;
  }
  return `private to ${message.readers.length} readers`;
}
