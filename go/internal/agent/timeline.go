package agent

import "time"

type timeline struct {
	epoch   string
	nextSeq uint64
	rows    []TimelineRow
}

func newTimeline(epoch string) timeline {
	return timeline{epoch: epoch, nextSeq: 1}
}

func (timeline *timeline) append(now time.Time, turnID string, item TimelineItem) TimelineRow {
	row := TimelineRow{
		Seq:       timeline.nextSeq,
		Timestamp: now,
		TurnID:    turnID,
		Item:      cloneTimelineItem(item),
	}
	timeline.nextSeq++
	timeline.rows = append(timeline.rows, row)
	return cloneTimelineRow(row)
}

func (timeline *timeline) snapshot() TimelineSnapshot {
	rows := make([]TimelineRow, len(timeline.rows))
	for index, row := range timeline.rows {
		rows[index] = cloneTimelineRow(row)
	}
	return TimelineSnapshot{Epoch: timeline.epoch, Rows: rows}
}

func (timeline *timeline) removeLast(seq uint64) bool {
	if len(timeline.rows) == 0 || timeline.rows[len(timeline.rows)-1].Seq != seq {
		return false
	}
	timeline.rows = timeline.rows[:len(timeline.rows)-1]
	timeline.nextSeq = seq
	return true
}

func (timeline *timeline) headSeq() uint64 {
	if len(timeline.rows) == 0 {
		return 0
	}
	return timeline.rows[len(timeline.rows)-1].Seq
}

func cloneTimelineRow(row TimelineRow) TimelineRow {
	row.Item = cloneTimelineItem(row.Item)
	return row
}

func cloneTimelineItem(item TimelineItem) TimelineItem {
	item.Input = append(item.Input[:0:0], item.Input...)
	item.Output = append(item.Output[:0:0], item.Output...)
	return item
}
