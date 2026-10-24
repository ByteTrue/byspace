// Package taskstate accumulates a provider's task-list tools into one todo snapshot.
//
// Ported from claude/task-state.ts. A model working through a plan reports it through tools — Claude uses
// TodoWrite and the Task* family — and the client renders those as the plan panel. Go had a renderer for
// the `todo` timeline item and nothing that ever produced one, so the panel was always empty.
//
// The two shapes are different, which is why this is stateful: TodoWrite replaces the whole list in one
// call, while TaskCreate/TaskUpdate/TaskList address individual tasks by id and the results carry the new
// state. Treating them alike loses the incremental updates.
package taskstate

import "strings"

// Item is one task in the list.
type Item struct {
	ID         string `json:"id,omitempty"`
	Text       string `json:"text"`
	Status     string `json:"status,omitempty"`
	Completed  bool   `json:"completed"`
	ActiveForm string `json:"activeForm,omitempty"`
}

// Snapshot is what the timeline item carries.
type Snapshot struct {
	Type  string `json:"type"`
	Items []Item `json:"items"`
}

// IsTaskTool reports whether a tool name is one of the task-list tools.
func IsTaskTool(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "todowrite", "taskcreate", "taskupdate", "tasklist":
		return true
	}
	return false
}

// pendingCall remembers a task tool's input until its result arrives.
type pendingCall struct {
	name  string
	input map[string]any
}

// State accumulates task tools for one conversation.
type State struct {
	tasks          map[string]Item
	order          []string
	calls          map[string]pendingCall
	appliedResults map[string]bool
}

// New builds an empty state.
func New() *State {
	return &State{
		tasks:          make(map[string]Item),
		calls:          make(map[string]pendingCall),
		appliedResults: make(map[string]bool),
	}
}

// Reset forgets everything.
func (s *State) Reset() {
	s.tasks = make(map[string]Item)
	s.order = nil
	s.calls = make(map[string]pendingCall)
	s.appliedResults = make(map[string]bool)
}

// ObserveCall records a tool use, returning a snapshot when the call itself changed the list.
//
// Only TodoWrite does: it sends the whole list in its input, so the card can update before the tool even
// finishes. The Task* tools report their effect in the result, which ObserveResult handles.
func (s *State) ObserveCall(callID, name string, input map[string]any) *Snapshot {
	if !IsTaskTool(name) {
		return nil
	}
	if callID != "" {
		s.calls[callID] = pendingCall{name: name, input: input}
	}
	if strings.EqualFold(name, "TodoWrite") {
		return s.replaceLegacy(input["todos"])
	}
	return nil
}

// ObserveResult applies a tool result, returning a snapshot when the list changed.
//
// A result is applied once: the same tool_result block can be replayed when a session is resumed, and
// applying it twice would undo a later update.
func (s *State) ObserveResult(callID string, structuredResult map[string]any) *Snapshot {
	if callID == "" || s.appliedResults[callID] {
		return nil
	}
	call, ok := s.calls[callID]
	if !ok {
		return nil
	}
	s.appliedResults[callID] = true
	delete(s.calls, callID)

	// A failed call changed nothing; applying its error object as data would invent tasks.
	if success, ok := structuredResult["success"].(bool); ok && !success {
		return nil
	}
	switch {
	case strings.EqualFold(call.name, "TaskCreate"):
		return s.applyCreate(call.input, structuredResult)
	case strings.EqualFold(call.name, "TaskUpdate"):
		return s.applyUpdate(call.input, structuredResult)
	case strings.EqualFold(call.name, "TaskList"):
		return s.applyList(structuredResult)
	}
	return nil
}

// replaceLegacy replaces the whole list from TodoWrite's input.
func (s *State) replaceLegacy(value any) *Snapshot {
	s.tasks = make(map[string]Item)
	s.order = nil
	list, ok := value.([]any)
	if !ok {
		return s.snapshot()
	}
	for index, raw := range list {
		item, ok := toItem(raw)
		if !ok {
			continue
		}
		if item.ID == "" {
			item.ID = "legacy:" + itoa(index)
		}
		s.set(item)
	}
	return s.snapshot()
}

// applyCreate adds a task from a TaskCreate result.
func (s *State) applyCreate(input, result map[string]any) *Snapshot {
	resultTask := asMap(result["task"])
	id := firstString(resultTask["id"], result["taskId"])
	text := firstString(resultTask["subject"], input["subject"])
	if id == "" || text == "" {
		return nil
	}
	item := Item{ID: id, Text: text, Status: "pending"}
	if activeForm := firstString(input["activeForm"]); activeForm != "" {
		item.ActiveForm = activeForm
	}
	s.set(item)
	return s.snapshot()
}

// applyUpdate changes or deletes one task.
func (s *State) applyUpdate(input, result map[string]any) *Snapshot {
	id := firstString(input["taskId"], result["taskId"])
	if id == "" {
		return nil
	}
	current, ok := s.tasks[id]
	if !ok {
		// An update for a task we never saw: applying it would create a row with no text.
		return nil
	}

	statusValue, hasStatus := input["status"]
	if !hasStatus {
		// A TaskUpdate result reports the transition instead.
		if change := asMap(result["statusChange"]); change != nil {
			statusValue, hasStatus = change["to"], true
		}
	}
	status := current.Status
	if hasStatus {
		status = normalizeStatus(statusValue)
	}
	if status == "deleted" {
		delete(s.tasks, id)
		s.removeFromOrder(id)
		return s.snapshot()
	}

	if text := firstString(input["subject"]); text != "" {
		current.Text = text
	}
	if activeForm := firstString(input["activeForm"]); activeForm != "" {
		current.ActiveForm = activeForm
	}
	current.Status = status
	current.Completed = status == "completed"
	s.set(current)
	return s.snapshot()
}

// applyList replaces the list from a TaskList result.
func (s *State) applyList(result map[string]any) *Snapshot {
	raw, ok := result["tasks"].([]any)
	if !ok {
		return nil
	}
	s.tasks = make(map[string]Item)
	s.order = nil
	for _, value := range raw {
		item, ok := toItem(value)
		if ok && item.ID != "" {
			s.set(item)
		}
	}
	return s.snapshot()
}

// set stores an item, keeping insertion order for a stable render.
func (s *State) set(item Item) {
	if _, exists := s.tasks[item.ID]; !exists {
		s.order = append(s.order, item.ID)
	}
	s.tasks[item.ID] = item
}

// removeFromOrder drops an id from the render order.
func (s *State) removeFromOrder(id string) {
	out := s.order[:0]
	for _, existing := range s.order {
		if existing != id {
			out = append(out, existing)
		}
	}
	s.order = out
}

// snapshot renders the current list in insertion order.
func (s *State) snapshot() *Snapshot {
	items := make([]Item, 0, len(s.tasks))
	for _, id := range s.order {
		if item, ok := s.tasks[id]; ok {
			items = append(items, item)
		}
	}
	return &Snapshot{Type: "todo", Items: items}
}

// toItem reads one task from the several shapes providers use.
func toItem(value any) (Item, bool) {
	record := asMap(value)
	if record == nil {
		return Item{}, false
	}
	text := firstString(record["text"], record["subject"], record["content"])
	if text == "" {
		return Item{}, false
	}
	item := Item{ID: firstString(record["id"], record["taskId"]), Text: text}
	status, hasStatus := record["status"]
	if hasStatus {
		item.Status = normalizeStatus(status)
	} else if completed, ok := record["completed"].(bool); ok && completed {
		item.Status = "completed"
	}
	item.Completed = item.Status == "completed"
	if activeForm := firstString(record["activeForm"], record["active_form"]); activeForm != "" {
		item.ActiveForm = activeForm
	}
	return item, true
}

// normalizeStatus maps a provider status onto the three the client renders.
func normalizeStatus(value any) string {
	text, _ := value.(string)
	switch text {
	case "completed":
		return "completed"
	case "deleted":
		return "deleted"
	case "in_progress", "inProgress", "running":
		return "in_progress"
	}
	return "pending"
}

// asMap reads a JSON object.
func asMap(value any) map[string]any {
	record, _ := value.(map[string]any)
	return record
}

// firstString returns the first non-empty trimmed string.
func firstString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok {
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

// itoa renders an int without pulling in strconv for one call site.
func itoa(value int) string {
	if value <= 0 {
		return "0"
	}
	var digits [8]byte
	index := len(digits)
	for value > 0 && index > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}
