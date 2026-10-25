package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// Keyset pagination cursors, ported from server/pagination/cursor.
//
// The previous cursor was the row offset as a decimal string. That is stable only while nothing
// changes: an agent finishing (or a new one appearing) between two page fetches shifts every
// later row, so the client sees a duplicate and never sees whatever fell into the gap. A keyset
// cursor carries the sort values and the id of the last row seen, so the next page continues from
// that row regardless of what was inserted before it.

// cursorSort is one sort key a cursor is bound to.
type cursorSort struct {
	Key       string `json:"key"`
	Direction string `json:"direction"`
}

// decodedCursor is the payload of a page cursor.
type decodedCursor struct {
	Sort   []cursorSort   `json:"sort"`
	Values map[string]any `json:"values"`
	ID     string         `json:"id"`
}

// encodeCursor builds a cursor for the last row of a page.
//
// It records the sort specification too: a cursor minted under a different ordering must be
// rejected rather than silently applied to the new one, which would skip rows.
func encodeCursor(id string, values map[string]any, sort []cursorSort) string {
	payload := decodedCursor{Sort: sort, Values: values, ID: id}
	raw, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// decodeCursor parses a cursor, rejecting one minted under a different sort.
func decodeCursor(cursor string, sort []cursorSort) (*decodedCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	var payload decodedCursor
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if payload.ID == "" {
		return nil, fmt.Errorf("invalid cursor: missing id")
	}
	if len(sort) > 0 {
		if len(payload.Sort) != len(sort) {
			return nil, fmt.Errorf("cursor does not match the requested sort")
		}
		for i := range sort {
			if payload.Sort[i].Key != sort[i].Key || payload.Sort[i].Direction != sort[i].Direction {
				return nil, fmt.Errorf("cursor does not match the requested sort")
			}
		}
	}
	return &payload, nil
}

// compareCursorValue orders a row against a cursor value for one sort key.
//
// Returns <0 when the row sorts before the cursor value, 0 when equal. A nil value sorts last in
// ascending order, matching the node implementation: "no activity yet" belongs at the end.
func compareCursorValue(rowValue any, cursorValue any, direction string) int {
	cmp := compareAnyValues(rowValue, cursorValue)
	if direction == "desc" {
		return -cmp
	}
	return cmp
}

// compareAnyValues compares two JSON-ish values, treating nil as the largest.
func compareAnyValues(a, b any) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return 1
	}
	if b == nil {
		return -1
	}

	af, aIsNum := toFloat(a)
	bf, bIsNum := toFloat(b)
	if aIsNum && bIsNum {
		switch {
		case af < bf:
			return -1
		case af > bf:
			return 1
		default:
			return 0
		}
	}

	as, aIsStr := a.(string)
	bs, bIsStr := b.(string)
	if aIsStr && bIsStr {
		switch {
		case as < bs:
			return -1
		case as > bs:
			return 1
		default:
			return 0
		}
	}

	// Mixed types: fall back to a stable textual form rather than claiming equality.
	aText := fmt.Sprintf("%v", a)
	bText := fmt.Sprintf("%v", b)
	switch {
	case aText < bText:
		return -1
	case aText > bText:
		return 1
	default:
		return 0
	}
}

func toFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}
