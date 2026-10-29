package server

import "github.com/ByteTrue/byspace/internal/store"

// Workspace state buckets, ported from packages/protocol/src/agent-state-bucket.ts.
//
// A workspace carries one bucket derived from the agents that belong to it, and the sidebar
// groups workspaces by that bucket. The numbers order the buckets by urgency: the lowest wins
// when several agents disagree, so a workspace with one blocked agent and one running agent is
// needs_input, not running.
const (
	bucketNeedsInput = "needs_input"
	bucketFailed     = "failed"
	bucketRunning    = "running"
	bucketAttention  = "attention"
	bucketDone       = "done"
)

func workspaceStateBucketPriority(bucket string) int {
	switch bucket {
	case bucketNeedsInput:
		return 0
	case bucketFailed:
		return 1
	case bucketRunning:
		return 2
	case bucketAttention:
		return 3
	default:
		return 4 // done, and anything unrecognised
	}
}

// deriveAgentStateBucket mirrors deriveAgentStateBucket in agent-state-bucket.ts.
//
// The order is the whole meaning: a pending permission outranks an error, which outranks a
// running turn. An agent that stopped to ask a question is not "failed" even when its last
// status says so — the user has something to answer.
func deriveAgentStateBucket(rec store.AgentRecord, pendingPermissionCount int) string {
	attentionReason := ""
	if rec.AttentionReason != nil {
		attentionReason = *rec.AttentionReason
	}
	switch {
	case pendingPermissionCount > 0 || attentionReason == "permission":
		return bucketNeedsInput
	case rec.LastStatus == "error" || attentionReason == "error":
		return bucketFailed
	case rec.LastStatus == "running":
		return bucketRunning
	case rec.RequiresAttention:
		return bucketAttention
	default:
		return bucketDone
	}
}

// computeWorkspaceStatusBuckets aggregates agent buckets into their owning workspace.
//
// Ported from applyAgentBucketContributions in workspace-directory.ts. Ownership follows the
// parent chain, not the cwd: two workspaces can share a directory, and a status that fanned out
// by cwd would light up both of their rows. Only the root agent of a workspace decides the
// bucket; descendants contribute `running` activity so a delegating conversation keeps its
// loader while the subagent works.
func (s *Server) computeWorkspaceStatusBuckets() map[string]string {
	agents, err := s.store.ListAgents()
	if err != nil {
		return map[string]string{}
	}
	active := make(map[string]store.AgentRecord, len(agents))
	for _, rec := range agents {
		if rec.ArchivedAt != nil {
			continue
		}
		active[rec.ID] = rec
	}

	// A loaded agent's in-memory record is ahead of the store: a turn start updates the status
	// for the live snapshot and does not write the file on every turn. Reading only the store
	// therefore reported every busy agent as idle, which is the one transition this aggregate
	// exists to show.
	pendingByAgent := s.overlayLoadedAgentRecords(active)

	buckets := make(map[string]string, len(active))
	for _, rec := range active {
		root := resolveWorkspaceRootAgent(rec, active)
		if root == nil || root.WorkspaceID == "" {
			continue
		}
		isRoot := root.ID == rec.ID
		if !isRoot && rec.LastStatus != "running" {
			continue
		}
		bucket := bucketRunning // a descendant only ever contributes activity
		if isRoot {
			bucket = deriveAgentStateBucket(rec, pendingByAgent[rec.ID])
		}
		existing, seen := buckets[root.WorkspaceID]
		if !seen || workspaceStateBucketPriority(bucket) < workspaceStateBucketPriority(existing) {
			buckets[root.WorkspaceID] = bucket
		}
	}
	return buckets
}

// overlayLoadedAgentRecords replaces stored records with the live ones and returns how many
// permission requests each loaded session is holding.
//
// The pending list lives on the session, not the record, so this is the only way to see it;
// taking both facts in one locked pass also keeps the two consistent with each other.
func (s *Server) overlayLoadedAgentRecords(active map[string]store.AgentRecord) map[string]int {
	counts := make(map[string]int, len(active))
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range active {
		mp := s.agents[id]
		if mp == nil {
			continue
		}
		if mp.record.ArchivedAt == nil {
			active[id] = mp.record
		}
		if mp.session != nil {
			if n := len(mp.session.PendingPermissions()); n > 0 {
				counts[id] = n
			}
		}
	}
	return counts
}

// refreshWorkspaceStatusBuckets recomputes the cache that workspaceDescriptor reads and returns
// the workspaces whose bucket changed.
//
// Called wherever an agent record or a pending permission can change. Kept as a cache rather than
// computed per descriptor because a workspace list builds one descriptor per row, and re-reading
// every agent record per row would turn one response into N directory scans.
func (s *Server) refreshWorkspaceStatusBuckets() map[string]string {
	buckets := s.computeWorkspaceStatusBuckets()
	changed := make(map[string]string)
	s.mu.Lock()
	for workspaceID, bucket := range buckets {
		if previous, ok := s.workspaceStatusBuckets[workspaceID]; !ok || previous != bucket {
			changed[workspaceID] = bucket
		}
	}
	s.workspaceStatusBuckets = buckets
	s.mu.Unlock()
	return changed
}

// publishWorkspaceStatusChanges pushes an upsert for every workspace whose bucket moved.
//
// The sidebar indicator reads the derived status the client computes from agent snapshots, but the
// workspace menu decides whether to offer "Mark as read" from `workspace.status` on the descriptor
// it already holds. Recomputing the cache without telling anyone left those two views disagreeing:
// the row showed attention while the menu still believed the workspace was done.
func (s *Server) publishWorkspaceStatusChanges() {
	changed := s.refreshWorkspaceStatusBuckets()
	if len(changed) == 0 {
		return
	}
	namespaces, err := s.store.ListWorkspaces()
	if err != nil {
		return
	}
	projects, _ := s.store.ListProjects()
	projectsByID := make(map[string]store.ProjectRecord, len(projects))
	for _, prj := range projects {
		projectsByID[prj.ProjectID] = prj
	}
	for _, ws := range namespaces {
		if _, ok := changed[ws.WorkspaceID]; !ok {
			continue
		}
		s.broadcastWorkspaceUpsert(ws, projectsByID[ws.ProjectID])
	}
}

// workspaceStatus returns the cached bucket for a workspace, defaulting to done.
func (s *Server) workspaceStatus(workspaceID string) string {
	s.mu.Lock()
	bucket, ok := s.workspaceStatusBuckets[workspaceID]
	s.mu.Unlock()
	if !ok {
		return bucketDone
	}
	return bucket
}

// HasActiveAgentWork reports whether any loaded agent session is currently running a turn
// or waiting on a pending permission request. Used by the desktop client's idle auto-updater.
func (s *Server) HasActiveAgentWork() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, mp := range s.agents {
		if mp == nil || mp.record.ArchivedAt != nil {
			continue
		}
		if mp.record.LastStatus == "running" {
			return true
		}
		if mp.session != nil && len(mp.session.PendingPermissions()) > 0 {
			return true
		}
	}
	return false
}
