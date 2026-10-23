// Package match ports packages/protocol/src/search/text-match.ts.
//
// The app's pickers and the daemon's history search share this ranked matcher: a match is a
// tier plus the offset it was found at, lower being better on both, so callers sort ascending.
package match

import "strings"

// Tiers, best to worst. The fuzzy tier always sorts after all of them.
const (
	TierExact       = 0
	TierWholeWord   = 1
	TierPrefix      = 2
	TierWordStart   = 3
	TierSubstring   = 4
	TierSubsequence = 5
	TierFuzzy       = 6
)

// Score is one match result.
type Score struct {
	Tier   int
	Offset int
	Spread int
}

// Policy bounds typo tolerance for one token. Null (nil) means match exactly.
type Policy struct {
	MaxEdits           int
	TranspositionsOnly bool
}

// PolicyForToken picks a typo budget by token length. Short tokens get transpositions and
// nothing else: at four characters a free substitution turns "main" into "mail", "maid" and
// "rain", while a swap can only ever reach the word the user meant.
func PolicyForToken(token string) *Policy {
	switch {
	case len(token) <= 3:
		return nil
	case len(token) == 4:
		return &Policy{MaxEdits: 1, TranspositionsOnly: true}
	case len(token) <= 7:
		return &Policy{MaxEdits: 1}
	default:
		return &Policy{MaxEdits: 2}
	}
}

func isWordBoundary(b byte) bool {
	return !((b >= 'a' && b <= 'z') || (b >= '0' && b <= '9'))
}

func scoreSubstring(query, text string) *Score {
	var best *Score
	for pos := 0; pos <= len(text)-len(query); pos++ {
		found := strings.Index(text[pos:], query)
		if found < 0 {
			break
		}
		found += pos
		startsAtBoundary := found == 0 || isWordBoundary(text[found-1])
		end := found + len(query)
		endsAtBoundary := end >= len(text) || isWordBoundary(text[end])

		var tier int
		switch {
		case startsAtBoundary && endsAtBoundary:
			tier = TierWholeWord
		case found == 0:
			tier = TierPrefix
		case startsAtBoundary:
			tier = TierWordStart
		default:
			tier = TierSubstring
		}
		if best == nil || tier < best.Tier || (tier == best.Tier && found < best.Offset) {
			best = &Score{Tier: tier, Offset: found}
		}
		pos = found
	}
	return best
}

func scoreSubsequence(query, text string) *Score {
	queryIndex, firstIndex, lastIndex := 0, -1, -1
	for textIndex := 0; textIndex < len(text) && queryIndex < len(query); textIndex++ {
		if text[textIndex] != query[queryIndex] {
			continue
		}
		if firstIndex == -1 {
			firstIndex = textIndex
		}
		lastIndex = textIndex
		queryIndex++
	}
	if queryIndex != len(query) || firstIndex == -1 {
		return nil
	}
	return &Score{Tier: TierSubsequence, Offset: firstIndex, Spread: lastIndex - firstIndex + 1}
}

// boundedEditDistance is Damerau-Levenshtein, abandoned as soon as every cell in a row is over
// budget. Bounding it keeps the fuzzy tier affordable across every word of every candidate.
func boundedEditDistance(query, word string, budget int) (int, bool) {
	if abs(len(query)-len(word)) > budget {
		return 0, false
	}
	var twoRowsBack []int
	previousRow := make([]int, len(word)+1)
	for i := range previousRow {
		previousRow[i] = i
	}
	for qi := 1; qi <= len(query); qi++ {
		currentRow := make([]int, len(word)+1)
		currentRow[0] = qi
		rowBest := qi
		for wi := 1; wi <= len(word); wi++ {
			substitution := 1
			if query[qi-1] == word[wi-1] {
				substitution = 0
			}
			cost := min3(
				currentRow[wi-1]+1,
				previousRow[wi]+1,
				previousRow[wi-1]+substitution,
			)
			if qi > 1 && wi > 1 && query[qi-1] == word[wi-2] && query[qi-2] == word[wi-1] {
				if len(twoRowsBack) > wi-2 {
					cost = min(cost, twoRowsBack[wi-2]+1)
				}
			}
			currentRow[wi] = cost
			if cost < rowBest {
				rowBest = cost
			}
		}
		if rowBest > budget {
			return 0, false
		}
		twoRowsBack = previousRow
		previousRow = currentRow
	}
	distance := previousRow[len(word)]
	if distance > budget {
		return 0, false
	}
	return distance, true
}

func isAdjacentTransposition(query, word string) bool {
	if len(query) != len(word) {
		return false
	}
	index := 0
	for index < len(query) && query[index] == word[index] {
		index++
	}
	if index >= len(query)-1 {
		return false
	}
	if query[index] != word[index+1] || query[index+1] != word[index] {
		return false
	}
	return query[index+2:] == word[index+2:]
}

func scoreFuzzy(query, text string, policy *Policy) *Score {
	if policy == nil || policy.MaxEdits <= 0 || len(query) <= policy.MaxEdits {
		return nil
	}
	var best *Score
	// Words are what people mistype, so compare against each word rather than the whole string:
	// a long title's length difference alone would blow the budget.
	isWord := func(b byte) bool {
		return (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9')
	}
	for i := 0; i < len(text); i++ {
		if !isWord(text[i]) {
			continue
		}
		start := i
		for i < len(text) && isWord(text[i]) {
			i++
		}
		word := text[start:i]
		candidates := []string{word}
		if len(word) > len(query) {
			candidates = append(candidates, word[:len(query)])
		}
		if len(word) > len(query)+policy.MaxEdits {
			candidates = append(candidates, word[:len(query)+policy.MaxEdits])
		}
		seen := map[string]bool{}
		for _, candidate := range candidates {
			if seen[candidate] {
				continue
			}
			seen[candidate] = true
			var distance int
			var ok bool
			if policy.TranspositionsOnly {
				if isAdjacentTransposition(query, candidate) {
					distance, ok = 1, true
				}
			} else {
				distance, ok = boundedEditDistance(query, candidate, policy.MaxEdits)
			}
			if !ok {
				continue
			}
			score := &Score{Tier: TierFuzzy, Offset: start, Spread: distance}
			if best == nil || CompareScore(score, best) < 0 {
				best = score
			}
		}
	}
	return best
}

// CompareScore orders two scores best-first.
func CompareScore(left, right *Score) int {
	switch {
	case left.Tier != right.Tier:
		return left.Tier - right.Tier
	case left.Offset != right.Offset:
		return left.Offset - right.Offset
	default:
		return left.Spread - right.Spread
	}
}

// Match scores query against text. Nil policy means exact matching only.
func Match(query, text string, policy *Policy) *Score {
	if query == "" {
		return &Score{Tier: TierExact}
	}
	q := strings.ToLower(query)
	t := strings.ToLower(text)
	if t == q {
		return &Score{Tier: TierExact}
	}
	if substring := scoreSubstring(q, t); substring != nil {
		return substring
	}
	if subsequence := scoreSubsequence(q, t); subsequence != nil {
		return subsequence
	}
	return scoreFuzzy(q, t, policy)
}

type compactText struct {
	value   string
	offsets []int
}

func compact(value string) compactText {
	var sb strings.Builder
	offsets := make([]int, 0, len(value))
	for index := 0; index < len(value); index++ {
		ch := value[index]
		isAlnum := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
		if !isAlnum {
			continue
		}
		sb.WriteByte(ch)
		offsets = append(offsets, index)
	}
	return compactText{value: sb.String(), offsets: offsets}
}

// MatchPath matches a query against a complete displayed path, including its separators.
func MatchPath(query, path string) *Score {
	if direct := Match(query, path, nil); direct != nil {
		return direct
	}
	compactQuery := compact(query)
	compactPath := compact(path)
	if compactQuery.value == "" || compactPath.value == "" {
		return nil
	}
	compactScore := Match(compactQuery.value, compactPath.value, nil)
	if compactScore == nil {
		return nil
	}
	if compactScore.Offset < len(compactPath.offsets) {
		compactScore.Offset = compactPath.offsets[compactScore.Offset]
	}
	return compactScore
}

// Range is one marked span in a matched field.
type Range struct {
	Start  int
	Length int
}

// Ranges derives where a score's match landed, so the client can mark the same glyphs the
// ranker scored. The tier decides the shape: a substring hit is one span, a subsequence hit is
// the scattered characters it walked, and a typo hit marks the whole word because the characters
// the user got wrong are not in the text to point at.
func Ranges(query, text string, score *Score) []Range {
	if query == "" || score == nil {
		return nil
	}
	q := strings.ToLower(query)
	t := strings.ToLower(text)
	switch score.Tier {
	case TierExact:
		return []Range{{Start: 0, Length: len(text)}}
	case TierFuzzy:
		end := score.Offset
		for end < len(t) && !isWordBoundary(t[end]) {
			end++
		}
		return []Range{{Start: score.Offset, Length: max(end-score.Offset, 1)}}
	case TierSubsequence:
		indices := make([]int, 0, len(q))
		queryIndex := 0
		for textIndex := 0; textIndex < len(t) && queryIndex < len(q); textIndex++ {
			if t[textIndex] != q[queryIndex] {
				continue
			}
			indices = append(indices, textIndex)
			queryIndex++
		}
		ranges := make([]Range, 0, len(indices))
		for _, index := range indices {
			if last := len(ranges) - 1; last >= 0 && ranges[last].Start+ranges[last].Length == index {
				ranges[last].Length++
				continue
			}
			ranges = append(ranges, Range{Start: index, Length: 1})
		}
		return ranges
	default:
		return []Range{{Start: score.Offset, Length: len(q)}}
	}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func min3(a, b, c int) int {
	return min(a, min(b, c))
}

// TokenizeQuery splits a free-text query into lowercase tokens.
//
// Tiers are computed per token rather than per query: a query mixes long words that can absorb
// a typo with short ones that cannot.
func TokenizeQuery(query string) []string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(query)))
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}
