import type {
  AgentSearchMatch,
  AgentSnapshotPayload,
  ProjectPlacementPayload,
} from "@bytetrue/byspace-protocol/messages";
import {
  compareMatchScores,
  fuzzyPolicyForToken,
  type MatchRange,
  type MatchScore,
  matchRanges,
  scoreMatch,
  tokenizeQuery,
} from "@bytetrue/byspace-protocol/search/text-match";

/**
 * History search ranks what the daemon already knows about a session: the four
 * names attached to it. Transcripts are deliberately out — they are unbounded,
 * and a partial-transcript index would answer "not found" for sessions that do
 * contain the phrase, which is worse than never claiming to search them.
 *
 * Field order is the tie-break order. Workspace and agent titles are what
 * people actually recall; a project name matches every session in the repo, so
 * it ranks last and only decides ties.
 */

export interface AgentHistorySearchCandidate {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload;
}

/** Covers normal titles and paths while bounding every synchronous field scan. */
export const AGENT_HISTORY_SEARCH_FIELD_CHARACTER_BUDGET = 512;

/** In tie-break order; the index into this list is a field's rank. */
const SEARCH_FIELDS = ["workspace", "title", "branch", "project"] as const;
const SEARCH_FIELD_HEAD_BUDGET = Math.ceil(AGENT_HISTORY_SEARCH_FIELD_CHARACTER_BUDGET / 2);
const SEARCH_FIELD_TAIL_BUDGET =
  AGENT_HISTORY_SEARCH_FIELD_CHARACTER_BUDGET - SEARCH_FIELD_HEAD_BUDGET;

type SearchField = (typeof SEARCH_FIELDS)[number];

function rawSearchableFields(candidate: AgentHistorySearchCandidate): string[] {
  const { agent, project } = candidate;
  return [
    project.workspaceName ?? "",
    agent.title ?? "",
    project.checkout.currentBranch ?? "",
    project.projectName,
  ];
}

interface BoundedSearchSegment {
  text: string;
  originalStart: number;
}

interface BoundedSearchField {
  segments: readonly BoundedSearchSegment[];
  characterCount: number;
}

interface BoundedFieldMatch {
  score: MatchScore;
  localScore: MatchScore;
  segment: BoundedSearchSegment;
}

interface FieldMatch extends BoundedFieldMatch {
  fieldRank: number;
  token: string;
}

export interface AgentHistorySearchWorkStats {
  boundedFieldCount: number;
  extractedCharacterCount: number;
  matchEvaluationCount: number;
}

export interface AgentHistorySearchScorer {
  readonly work: Readonly<AgentHistorySearchWorkStats>;
  scoreCandidate(candidate: AgentHistorySearchCandidate): number | null;
  describeCandidate(candidate: AgentHistorySearchCandidate): AgentSearchMatch[];
}

export interface BoundedAgentHistoryText {
  head: string;
  tail: string | null;
  tailStart: number | null;
}

/** Extracts the only candidate text that searched History may inspect. */
export function boundAgentHistoryText(raw: string): BoundedAgentHistoryText {
  const head = raw.slice(0, SEARCH_FIELD_HEAD_BUDGET);
  if (raw.length <= SEARCH_FIELD_HEAD_BUDGET) {
    return { head, tail: null, tailStart: null };
  }

  const tailStart = Math.max(SEARCH_FIELD_HEAD_BUDGET, raw.length - SEARCH_FIELD_TAIL_BUDGET);
  return { head, tail: raw.slice(tailStart), tailStart };
}

/** Case-insensitive ordering over the same bounded representation used by search. */
export function compareBoundedAgentHistoryText(left: string, right: string): number {
  const leftBounded = boundAgentHistoryText(left);
  const rightBounded = boundAgentHistoryText(right);
  const headComparison = leftBounded.head
    .toLowerCase()
    .localeCompare(rightBounded.head.toLowerCase());
  if (headComparison !== 0) return headComparison;

  // A nullable tail is an explicit separator, so head-only and head/tail
  // representations cannot collapse into an ambiguous concatenated key.
  if (leftBounded.tail === null || rightBounded.tail === null) {
    if (leftBounded.tail === rightBounded.tail) return 0;
    return leftBounded.tail === null ? -1 : 1;
  }
  return leftBounded.tail.toLowerCase().localeCompare(rightBounded.tail.toLowerCase());
}

function normalizeBoundedField(raw: string): BoundedSearchField {
  const bounded = boundAgentHistoryText(raw);
  const head = bounded.head.toLowerCase();
  if (bounded.tail === null || bounded.tailStart === null) {
    return { segments: [{ text: head, originalStart: 0 }], characterCount: head.length };
  }

  const tail = bounded.tail.toLowerCase();
  return {
    // Separate segments deliberately prevent substring, subsequence, and fuzzy
    // matches from crossing an omitted middle.
    segments: [
      { text: head, originalStart: 0 },
      { text: tail, originalStart: bounded.tailStart },
    ],
    characterCount: head.length + tail.length,
  };
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: MatchRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.start + last.length) {
      last.length = Math.max(last.length, range.start + range.length - last.start);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * One number so the wire can carry relevance and several hosts' pages can be
 * merged by it. Tier dominates, then which field matched, then how deep into
 * that field the match sat.
 */
function toSearchScore(matches: readonly FieldMatch[]): number {
  let total = 0;
  for (const match of matches) {
    total += match.score.tier * 1_000 + match.fieldRank * 100 + Math.min(match.score.offset, 99);
  }
  return total;
}

export function createAgentHistorySearchScorer(query: string): AgentHistorySearchScorer {
  const tokens = tokenizeQuery(query);
  // Cache keys contain only the bounded normalized segment and query token.
  // Candidate-local offsets never enter the cache.
  const matchesByToken = new Map<string, Map<string, MatchScore | null>>();
  const work: AgentHistorySearchWorkStats = {
    boundedFieldCount: 0,
    extractedCharacterCount: 0,
    matchEvaluationCount: 0,
  };

  function boundedField(raw: string): BoundedSearchField {
    const field = normalizeBoundedField(raw);
    work.boundedFieldCount += 1;
    work.extractedCharacterCount += field.characterCount;
    return field;
  }

  function matchBoundedSegment(token: string, segment: string): MatchScore | null {
    let matchesForToken = matchesByToken.get(token);
    if (!matchesForToken) {
      matchesForToken = new Map();
      matchesByToken.set(token, matchesForToken);
    }
    if (matchesForToken.has(segment)) return matchesForToken.get(segment) ?? null;

    work.matchEvaluationCount += 1;
    const match = scoreMatch(token, segment, { fuzzy: fuzzyPolicyForToken(token) });
    matchesForToken.set(segment, match);
    return match;
  }

  function matchBoundedField(token: string, field: BoundedSearchField): BoundedFieldMatch | null {
    let best: BoundedFieldMatch | null = null;
    for (const segment of field.segments) {
      const localScore = matchBoundedSegment(token, segment.text);
      if (!localScore) continue;
      const score = { ...localScore, offset: segment.originalStart + localScore.offset };
      if (!best || compareMatchScores(score, best.score) < 0) {
        best = { score, localScore, segment };
      }
    }
    return best;
  }

  function matchCandidate(candidate: AgentHistorySearchCandidate): FieldMatch[] | null {
    if (tokens.length === 0) return null;
    const fields = rawSearchableFields(candidate).map(boundedField);
    const matches: FieldMatch[] = [];
    for (const token of tokens) {
      let best: FieldMatch | null = null;
      for (let fieldRank = 0; fieldRank < fields.length; fieldRank += 1) {
        const match = matchBoundedField(token, fields[fieldRank]);
        if (!match) continue;
        if (!best || compareMatchScores(match.score, best.score) < 0) {
          best = { ...match, fieldRank, token };
        }
      }
      if (!best) return null;
      matches.push(best);
    }
    return matches;
  }

  return {
    work,
    scoreCandidate(candidate) {
      const matches = matchCandidate(candidate);
      return matches ? toSearchScore(matches) : null;
    },
    describeCandidate(candidate) {
      const matches = matchCandidate(candidate);
      if (!matches) return [];

      const rangesByField = new Map<SearchField, MatchRange[]>();
      for (const match of matches) {
        const field = SEARCH_FIELDS[match.fieldRank];
        const ranges = matchRanges(match.token, match.segment.text, match.localScore).map(
          (range) => ({
            start: range.start + match.segment.originalStart,
            length: range.length,
          }),
        );
        rangesByField.set(field, [...(rangesByField.get(field) ?? []), ...ranges]);
      }

      return [...rangesByField.entries()].map(([field, ranges]) => ({
        field,
        ranges: mergeRanges(ranges),
      }));
    },
  };
}

/**
 * Every token has to match something, so adding a word always narrows. Tokens
 * may land on different fields — "stripe main" finds the Stripe workspace on
 * the main branch.
 */
export function scoreAgentHistoryCandidate(
  query: string,
  candidate: AgentHistorySearchCandidate,
): number | null {
  return createAgentHistorySearchScorer(query).scoreCandidate(candidate);
}

/**
 * Where the query landed in each field, for callers that only need one row.
 * Search requests reuse one scorer for ranking and descriptions instead.
 */
export function describeAgentHistoryMatches(
  query: string,
  candidate: AgentHistorySearchCandidate,
): AgentSearchMatch[] {
  return createAgentHistorySearchScorer(query).describeCandidate(candidate);
}

export interface RankedAgentHistoryCandidate<T extends AgentHistorySearchCandidate> {
  candidate: T;
  searchScore: number;
}

/**
 * Ranks the whole candidate set rather than a page of it. The daemon holds
 * every persisted agent in memory already, so search is complete by
 * construction and the client never has to warn that it only looked at what it
 * had loaded.
 *
 * A searched response is one page: the best `limit` matches, and a flag saying
 * more matched. There is no search cursor. Offsets into a ranking that is
 * recomputed per request duplicate and skip rows as history mutates underneath
 * them, and a keyset cursor would buy the ability to walk past result 200 of a
 * relevance order — which is browsing, not searching. Narrowing the query is
 * the answer, and the global top K is exactly recoverable from each host's own
 * top K, which is what lets several hosts merge without a federated pager.
 */
export function rankAgentHistoryCandidates<T extends AgentHistorySearchCandidate>(input: {
  scorer: AgentHistorySearchScorer;
  candidates: readonly T[];
  compareTies: (left: T, right: T) => number;
}): RankedAgentHistoryCandidate<T>[] {
  const ranked: RankedAgentHistoryCandidate<T>[] = [];
  for (const candidate of input.candidates) {
    const searchScore = input.scorer.scoreCandidate(candidate);
    if (searchScore === null) continue;
    ranked.push({ candidate, searchScore });
  }
  ranked.sort((left, right) => {
    if (left.searchScore !== right.searchScore) return left.searchScore - right.searchScore;
    return input.compareTies(left.candidate, right.candidate);
  });
  return ranked;
}
