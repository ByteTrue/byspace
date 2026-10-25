package store

// BuildArchivedAgentRecord returns the record an archived agent should be stored as.
//
// Ported from agent-archive.ts. Two details there are easy to drop and both are visible to the user:
//
//   - A running or initializing agent becomes idle, not "closed". "closed" means the provider is
//     gone; an archived agent is still a readable transcript, and the status is what the sidebar
//     uses to decide whether to show a spinner.
//   - Attention is cleared. An archived agent that still carries requiresAttention keeps its unread
//     dot forever, because nothing will ever resolve it — the agent cannot finish a turn after being
//     archived.
func BuildArchivedAgentRecord(record AgentRecord, archivedAt string) AgentRecord {
	archived := record
	archived.ArchivedAt = &archivedAt
	if archived.UpdatedAt == "" {
		archived.UpdatedAt = archivedAt
	}
	if archived.LastStatus == "running" || archived.LastStatus == "initializing" {
		archived.LastStatus = "idle"
	}
	archived.RequiresAttention = false
	archived.AttentionReason = nil
	archived.AttentionTimestamp = nil
	return archived
}
