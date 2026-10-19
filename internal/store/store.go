package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
)

// ProjectRecord mirrors PersistedProjectRecord in packages/server/src/server/workspace-registry.ts.
type ProjectRecord struct {
	ProjectID          string  `json:"projectId"`
	RootPath           string  `json:"rootPath"`
	Kind               string  `json:"kind"` // "git" | "non_git"
	DisplayName        string  `json:"displayName"`
	ProjectKey         *string `json:"projectKey"`
	CustomName         *string `json:"customName"`
	CustomIconRevision *string `json:"customIconRevision"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
	ArchivedAt         *string `json:"archivedAt"`
}

// WorkspaceRecord mirrors PersistedWorkspaceRecord in packages/server/src/server/workspace-registry.ts.
type WorkspaceRecord struct {
	WorkspaceID                  string   `json:"workspaceId"`
	ProjectID                    string   `json:"projectId"`
	Cwd                          string   `json:"cwd"`
	Kind                         string   `json:"kind"` // "local_checkout" | "worktree" | "directory"
	DisplayName                  string   `json:"displayName"`
	Title                        *string  `json:"title"`
	Branch                       *string  `json:"branch"`
	WorktreeRoot                 *string  `json:"worktreeRoot"`
	BaseBranch                   *string  `json:"baseBranch"`
	IsBySpaceOwnedWorktree       bool     `json:"isBySpaceOwnedWorktree"`
	MainRepoRoot                 *string  `json:"mainRepoRoot"`
	CreatedAt                    string   `json:"createdAt"`
	UpdatedAt                    string   `json:"updatedAt"`
	ArchivedAt                   *string  `json:"archivedAt"`
	AutoArchivedChangeRequestURL *string  `json:"autoArchivedChangeRequestUrl"`
	PinnedAt                     *string  `json:"pinnedAt"`
	Labels                       []string `json:"labels,omitempty"`
}

// AgentRuntimeInfo mirrors runtimeInfo in StoredAgentRecord.
type AgentRuntimeInfo struct {
	Provider         string         `json:"provider"`
	SessionID        *string        `json:"sessionId"`
	Model            *string        `json:"model,omitempty"`
	ThinkingOptionID *string        `json:"thinkingOptionId,omitempty"`
	ModeID           *string        `json:"modeId,omitempty"`
	Extra            map[string]any `json:"extra,omitempty"`
}

// AgentPersistenceHandle mirrors persistence in StoredAgentRecord.
type AgentPersistenceHandle struct {
	Provider     string         `json:"provider"`
	SessionID    string         `json:"sessionId"`
	NativeHandle any            `json:"nativeHandle,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// AgentConfig mirrors SerializableAgentConfig in StoredAgentRecord.
type AgentConfig struct {
	ModeID           *string        `json:"modeId,omitempty"`
	Model            *string        `json:"model,omitempty"`
	ThinkingOptionID *string        `json:"thinkingOptionId,omitempty"`
	FeatureValues    map[string]any `json:"featureValues,omitempty"`
	ProviderOptions  map[string]any `json:"providerOptions,omitempty"`
	SystemPrompt     *string        `json:"systemPrompt,omitempty"`
	Role             *string        `json:"role,omitempty"`
	McpServers       map[string]any `json:"mcpServers,omitempty"`
}

// AgentRecord mirrors StoredAgentRecord in packages/server/src/server/agent/agent-storage.ts.
type AgentRecord struct {
	ID                 string                  `json:"id"`
	Provider           string                  `json:"provider"`
	Cwd                string                  `json:"cwd"`
	WorkspaceID        string                  `json:"workspaceId,omitempty"`
	CreatedAt          string                  `json:"createdAt"`
	UpdatedAt          string                  `json:"updatedAt"`
	LastActivityAt     string                  `json:"lastActivityAt,omitempty"`
	LastUserMessageAt  *string                 `json:"lastUserMessageAt,omitempty"`
	Title              *string                 `json:"title"`
	Labels             map[string]string       `json:"labels"`
	LastStatus         string                  `json:"lastStatus"`
	LastModeID         *string                 `json:"lastModeId,omitempty"`
	Config             *AgentConfig            `json:"config,omitempty"`
	RuntimeInfo        *AgentRuntimeInfo       `json:"runtimeInfo,omitempty"`
	Persistence        *AgentPersistenceHandle `json:"persistence,omitempty"`
	LastError          *string                 `json:"lastError,omitempty"`
	RequiresAttention  bool                    `json:"requiresAttention,omitempty"`
	AttentionReason    *string                 `json:"attentionReason,omitempty"`
	AttentionTimestamp *string                 `json:"attentionTimestamp,omitempty"`
	Internal           bool                    `json:"internal,omitempty"`
	ArchivedAt         *string                 `json:"archivedAt,omitempty"`
}

// Store manages the file-backed JSON stores under $BYSPACE_HOME.
type Store struct {
	mu      sync.RWMutex
	homeDir string
}

// New creates a Store rooted at homeDir.
func New(homeDir string) *Store {
	return &Store{homeDir: homeDir}
}

func (s *Store) projectsPath() string {
	return filepath.Join(s.homeDir, "projects", "projects.json")
}

func (s *Store) workspacesPath() string {
	return filepath.Join(s.homeDir, "projects", "workspaces.json")
}

func (s *Store) agentsBaseDir() string {
	return filepath.Join(s.homeDir, "agents")
}

// NewProjectID generates an opaque "prj_<16 hex>" identifier.
func NewProjectID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "prj_" + hex.EncodeToString(b[:])
}

// NewWorkspaceID generates an opaque "wks_<16 hex>" identifier.
func NewWorkspaceID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "wks_" + hex.EncodeToString(b[:])
}

// ListProjects reads all persisted projects from $BYSPACE_HOME/projects/projects.json.
func (s *Store) ListProjects() ([]ProjectRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONArray[ProjectRecord](s.projectsPath())
}

// UpsertProject inserts or replaces a project record and persists atomically.
func (s *Store) UpsertProject(record ProjectRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := readJSONArray[ProjectRecord](s.projectsPath())
	if err != nil {
		return err
	}
	found := false
	for i := range list {
		if list[i].ProjectID == record.ProjectID {
			list[i] = record
			found = true
			break
		}
	}
	if !found {
		list = append(list, record)
	}
	return writeJSONArray(s.projectsPath(), list)
}

// ListWorkspaces reads all persisted workspaces from $BYSPACE_HOME/projects/workspaces.json.
func (s *Store) ListWorkspaces() ([]WorkspaceRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONArray[WorkspaceRecord](s.workspacesPath())
}

// UpsertWorkspace inserts or replaces a workspace record and persists atomically.
func (s *Store) UpsertWorkspace(record WorkspaceRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := readJSONArray[WorkspaceRecord](s.workspacesPath())
	if err != nil {
		return err
	}
	found := false
	for i := range list {
		if list[i].WorkspaceID == record.WorkspaceID {
			list[i] = record
			found = true
			break
		}
	}
	if !found {
		list = append(list, record)
	}
	return writeJSONArray(s.workspacesPath(), list)
}

// EnsureWorkspaceForCwd finds an active workspace matching cwd, or creates a project + workspace pair.
func (s *Store) EnsureWorkspaceForCwd(cwd string) (ProjectRecord, WorkspaceRecord, error) {
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		absCwd = cwd
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	baseName := filepath.Base(absCwd)
	if baseName == "" || baseName == "/" || baseName == "." {
		baseName = "workspace"
	}

	projects, err := s.ListProjects()
	if err != nil {
		return ProjectRecord{}, WorkspaceRecord{}, err
	}
	workspaces, err := s.ListWorkspaces()
	if err != nil {
		return ProjectRecord{}, WorkspaceRecord{}, err
	}

	for _, ws := range workspaces {
		if ws.ArchivedAt == nil && ws.Cwd == absCwd {
			for _, prj := range projects {
				if prj.ProjectID == ws.ProjectID {
					return prj, ws, nil
				}
			}
		}
	}

	var matchedProject *ProjectRecord
	for i := range projects {
		if projects[i].ArchivedAt == nil && projects[i].RootPath == absCwd {
			matchedProject = &projects[i]
			break
		}
	}
	if matchedProject == nil {
		kind := "non_git"
		if _, err := os.Stat(filepath.Join(absCwd, ".git")); err == nil {
			kind = "git"
		}
		prjKey := absCwd
		newPrj := ProjectRecord{
			ProjectID:   NewProjectID(),
			RootPath:    absCwd,
			Kind:        kind,
			DisplayName: baseName,
			ProjectKey:  &prjKey,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := s.UpsertProject(newPrj); err != nil {
			return ProjectRecord{}, WorkspaceRecord{}, err
		}
		matchedProject = &newPrj
	}

	wsKind := "directory"
	if matchedProject.Kind == "git" {
		wsKind = "local_checkout"
	}
	rootCopy := absCwd
	newWS := WorkspaceRecord{
		WorkspaceID:  NewWorkspaceID(),
		ProjectID:    matchedProject.ProjectID,
		Cwd:          absCwd,
		Kind:         wsKind,
		DisplayName:  baseName,
		WorktreeRoot: &rootCopy,
		MainRepoRoot: &rootCopy,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.UpsertWorkspace(newWS); err != nil {
		return ProjectRecord{}, WorkspaceRecord{}, err
	}
	return *matchedProject, newWS, nil
}

// ListAgents scans $BYSPACE_HOME/agents/**/*.json and returns all stored agent records.
func (s *Store) ListAgents() ([]AgentRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	base := s.agentsBaseDir()
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []AgentRecord{}, nil
		}
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		full := filepath.Join(base, entry.Name())
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			files = append(files, full)
			continue
		}
		if entry.IsDir() {
			subEntries, err := os.ReadDir(full)
			if err != nil {
				continue
			}
			for _, sub := range subEntries {
				if !sub.IsDir() && strings.HasSuffix(sub.Name(), ".json") {
					files = append(files, filepath.Join(full, sub.Name()))
				}
			}
		}
	}

	out := make([]AgentRecord, 0, len(files))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var rec AgentRecord
		if err := json.Unmarshal(raw, &rec); err != nil || rec.ID == "" {
			continue
		}
		if rec.Labels == nil {
			rec.Labels = map[string]string{}
		}
		if rec.LastStatus == "" {
			rec.LastStatus = "closed"
		}
		out = append(out, rec)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out, nil
}

// GetAgent returns a single persisted agent record by ID, or nil if not found.
func (s *Store) GetAgent(agentID string) (*AgentRecord, error) {
	list, err := s.ListAgents()
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == agentID {
			return &list[i], nil
		}
	}
	return nil, nil
}

// UpsertAgent writes an agent record to $BYSPACE_HOME/agents/{project-dir}/{agentId}.json atomically.
func (s *Store) UpsertAgent(record AgentRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if record.Labels == nil {
		record.Labels = map[string]string{}
	}
	if record.LastStatus == "" {
		record.LastStatus = "closed"
	}
	dirName := ProjectDirNameFromCwd(record.Cwd)
	target := filepath.Join(s.agentsBaseDir(), dirName, record.ID+".json")
	b, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(target, append(b, '\n'), 0o600)
}

// DeleteAgent removes an agent record from $BYSPACE_HOME/agents/**/*.json.
func (s *Store) DeleteAgent(agentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	base := s.agentsBaseDir()
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	targetName := agentID + ".json"
	for _, entry := range entries {
		full := filepath.Join(base, entry.Name())
		if !entry.IsDir() && entry.Name() == targetName {
			_ = os.Remove(full)
			continue
		}
		if entry.IsDir() {
			_ = os.Remove(filepath.Join(full, targetName))
		}
	}
	return nil
}

// ArchiveWorkspace sets ArchivedAt on a workspace record and returns the updated record.
func (s *Store) ArchiveWorkspace(workspaceID, archivedAt string) (*WorkspaceRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := readJSONArray[WorkspaceRecord](s.workspacesPath())
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].WorkspaceID == workspaceID {
			list[i].ArchivedAt = &archivedAt
			list[i].UpdatedAt = archivedAt
			if err := writeJSONArray(s.workspacesPath(), list); err != nil {
				return nil, err
			}
			cp := list[i]
			return &cp, nil
		}
	}
	return nil, nil
}

// ProjectDirNameFromCwd mirrors projectDirNameFromCwd in packages/server/src/server/agent/agent-storage.ts.
func ProjectDirNameFromCwd(cwd string) string {
	trimmed := strings.TrimRight(cwd, `/\`)
	if trimmed == "" {
		return "root"
	}
	var parts []string
	for _, seg := range strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '/' || r == '\\' || r == ':'
	}) {
		if seg != "" {
			parts = append(parts, seg)
		}
	}
	if len(parts) == 0 {
		return "root"
	}
	return strings.Join(parts, "-")
}

func readJSONArray[T any](filePath string) ([]T, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []T{}, nil
		}
		return nil, err
	}
	var list []T
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	if list == nil {
		list = []T{}
	}
	return list, nil
}

func writeJSONArray[T any](filePath string, records []T) error {
	if records == nil {
		records = []T{}
	}
	b, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(filePath, append(b, '\n'), 0o600)
}
