package providers

import "github.com/ByteTrue/byspace/internal/agent/sdk"

// failRunningToolCalls settles rows that cannot outlive their cancelled turn.
// The caller emits the resulting timeline updates while holding its session lock.
func failRunningToolCalls(timeline []sdk.TimelineEntry, reason string) []int {
	updated := make([]int, 0)
	for index := range timeline {
		item := &timeline[index].Item
		if item.Type != "tool_call" || item.Status != "running" {
			continue
		}
		item.Status = "failed"
		item.Error = reason
		updated = append(updated, index)
	}
	return updated
}
