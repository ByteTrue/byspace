package server

import (
	"sort"
	"strings"

	"github.com/ByteTrue/byspace/internal/match"
	"github.com/ByteTrue/byspace/internal/store"
)

// Agent history search, ported from agent-history-search.ts.
//
// It ranks what the daemon already knows about a session — the four names attached to it —
// rather than transcripts. Transcripts are unbounded, and a partial index would answer "not
// found" for sessions that do contain the phrase, which is worse than not claiming to search
// them at all.

// searchFields is in tie-break order: workspace and agent titles are what people recall; a
// project name matches every session in the repo, so it only decides ties.
func agentSearchFields(rec store.AgentRecord, placement map[string]any) []string {
	workspace, _ := placement["workspaceName"].(string)
	project, _ := placement["projectName"].(string)
	branch := ""
	if checkout, ok := placement["checkout"].(map[string]any); ok {
		branch, _ = checkout["currentBranch"].(string)
	}
	title := ""
	if rec.Title != nil {
		title = *rec.Title
	}
	return []string{workspace, title, branch, project}
}

type fieldMatch struct {
	tier      int
	fieldRank int
	offset    int
}

// bestFieldMatch picks the strongest single-field match for one token.
func bestFieldMatch(token string, fields []string) (fieldMatch, bool) {
	policy := match.PolicyForToken(token)
	best := fieldMatch{}
	found := false
	for rank, field := range fields {
		if strings.TrimSpace(field) == "" {
			continue
		}
		score := match.Match(token, field, policy)
		if score == nil {
			continue
		}
		candidate := fieldMatch{tier: score.Tier, fieldRank: rank, offset: score.Offset}
		if !found || betterMatch(candidate, best) {
			best, found = candidate, true
		}
	}
	return best, found
}

// betterMatch mirrors compareMatchScores: tier dominates, then field, then offset.
func betterMatch(a, b fieldMatch) bool {
	if a.tier != b.tier {
		return a.tier < b.tier
	}
	if a.fieldRank != b.fieldRank {
		return a.fieldRank < b.fieldRank
	}
	return a.offset < b.offset
}

// scoreAgentHistoryCandidate returns a relevance score, or false when any token fails to match.
//
// Every token has to match something, so adding a word always narrows. Tokens may land on
// different fields — "stripe main" finds the Stripe workspace on the main branch.
func scoreAgentHistoryCandidate(query string, rec store.AgentRecord, placement map[string]any) (int, bool) {
	tokens := match.TokenizeQuery(query)
	if len(tokens) == 0 {
		return 0, false
	}
	fields := agentSearchFields(rec, placement)
	total := 0
	for _, token := range tokens {
		m, ok := bestFieldMatch(token, fields)
		if !ok {
			return 0, false
		}
		// One number so the wire can carry relevance and pages from several hosts can be
		// merged by it.
		total += m.tier*1000 + m.fieldRank*100 + min(m.offset, 99)
	}
	return total, true
}

// agentSearchFieldNames is match field order, and the wire names the client keys spans by.
var agentSearchFieldNames = []string{"workspace", "title", "branch", "project"}

// describeAgentHistoryMatches reports where the query landed in each field of a row that the
// ranker kept. Only the rows that get rendered need this, so it re-derives rather than making
// ranking carry ranges it never uses.
func describeAgentHistoryMatches(query string, rec store.AgentRecord, placement map[string]any) []any {
	fields := agentSearchFields(rec, placement)
	tokens := match.TokenizeQuery(query)
	if len(tokens) == 0 {
		return []any{}
	}
	byField := make(map[string][]match.Range)
	order := make([]string, 0, len(agentSearchFieldNames))
	for _, token := range tokens {
		fieldRank := -1
		var best *match.Score
		for rank, field := range fields {
			if strings.TrimSpace(field) == "" {
				continue
			}
			score := match.Match(token, field, match.PolicyForToken(token))
			if score == nil {
				continue
			}
			if best == nil || match.CompareScore(score, best) < 0 {
				best, fieldRank = score, rank
			}
		}
		if best == nil || fieldRank < 0 || fieldRank >= len(agentSearchFieldNames) {
			continue
		}
		name := agentSearchFieldNames[fieldRank]
		if _, seen := byField[name]; !seen {
			order = append(order, name)
		}
		byField[name] = append(byField[name], match.Ranges(token, fields[fieldRank], best)...)
	}

	matches := make([]any, 0, len(order))
	for _, name := range order {
		merged := make([]match.Range, 0, len(byField[name]))
		ranges := byField[name]
		sort.Slice(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
		for _, r := range ranges {
			if last := len(merged) - 1; last >= 0 && r.Start <= merged[last].Start+merged[last].Length {
				if end := r.Start + r.Length; end > merged[last].Start+merged[last].Length {
					merged[last].Length = end - merged[last].Start
				}
				continue
			}
			merged = append(merged, r)
		}
		spanList := make([]any, 0, len(merged))
		for _, r := range merged {
			spanList = append(spanList, map[string]any{"start": r.Start, "length": r.Length})
		}
		matches = append(matches, map[string]any{"field": name, "ranges": spanList})
	}
	return matches
}

// rankAgentsBySearch returns the records matching query, best first.
//
// Records whose score ties keep their incoming order (stable sort), so the caller's own
// ordering stays the tie-break and pagination remains deterministic.
func rankAgentsBySearch(records []store.AgentRecord, query string, placement func(store.AgentRecord) map[string]any) []store.AgentRecord {
	type scored struct {
		rec   store.AgentRecord
		score int
	}
	matches := make([]scored, 0, len(records))
	for _, rec := range records {
		if score, ok := scoreAgentHistoryCandidate(query, rec, placement(rec)); ok {
			matches = append(matches, scored{rec: rec, score: score})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].score < matches[j].score })

	out := make([]store.AgentRecord, len(matches))
	for i, m := range matches {
		out[i] = m.rec
	}
	return out
}
