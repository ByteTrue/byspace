package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/pathutil"
	"github.com/ByteTrue/byspace/internal/projectkey"
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
	WorkspaceID string `json:"workspaceId"`
	ProjectID   string `json:"projectId"`
	Cwd         string `json:"cwd"`
	Kind        string `json:"kind"` // "local_checkout" | "worktree" | "directory"
	// UntrustedSource marks a workspace checked out from someone else's change request. Its
	// byspace.json belongs to that author, so setup and scripts stay blocked until the user
	// explicitly allows them (`workspace.setup` clears it).
	UntrustedSource              *UntrustedSource `json:"untrustedSource,omitempty"`
	DisplayName                  string           `json:"displayName"`
	Title                        *string          `json:"title"`
	Branch                       *string          `json:"branch"`
	WorktreeRoot                 *string          `json:"worktreeRoot"`
	BaseBranch                   *string          `json:"baseBranch"`
	IsBySpaceOwnedWorktree       bool             `json:"isBySpaceOwnedWorktree"`
	MainRepoRoot                 *string          `json:"mainRepoRoot"`
	CreatedAt                    string           `json:"createdAt"`
	UpdatedAt                    string           `json:"updatedAt"`
	ArchivedAt                   *string          `json:"archivedAt"`
	AutoArchivedChangeRequestURL *string          `json:"autoArchivedChangeRequestUrl"`
	PinnedAt                     *string          `json:"pinnedAt"`
	Labels                       []string         `json:"labels,omitempty"`
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
	ParentAgentID      *string                 `json:"parentAgentId,omitempty"`
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
	Usage              any                     `json:"lastUsage,omitempty"`
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
	// serverID prefixes path-derived project keys so two hosts' local projects never collide.
	serverID string
	mu       sync.RWMutex
	homeDir  string
}

const (
	HomeWorkspaceLabel   = "byspace.home-workspace"
	HomeWorkspaceTitle   = "Chief"
	HomeProjectName      = "BySpace-WorkSpace"
	HomeWorkspaceDirName = "chief"
)

// New creates a Store rooted at homeDir.
func New(homeDir string) *Store {
	return &Store{homeDir: homeDir}
}

// EnsureHomeWorkspace ensures the daemon-owned Chief home workspace ($BYSPACE_HOME/chief)
// exists with the reserved "byspace.home-workspace" label and "BySpace-WorkSpace" project name.
func (s *Store) EnsureHomeWorkspace(serverID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	homeCwd := filepath.Join(s.homeDir, HomeWorkspaceDirName)
	if err := os.MkdirAll(homeCwd, 0o700); err != nil {
		return err
	}

	projects, _ := readJSONArray[ProjectRecord](s.projectsPath())
	workspaces, _ := readJSONArray[WorkspaceRecord](s.workspacesPath())

	// Presentation is re-asserted on every boot, not only at creation: the names and the label
	// are the daemon's, and a release may change them. A record whose label was lost (hand
	// edit, older build, a bad merge) otherwise stops being recognised as Home, so Chief is no
	// longer pinned and gains a `+` button like an ordinary project.
	for i := range workspaces {
		hasLabel := false
		for _, lbl := range workspaces[i].Labels {
			if lbl == HomeWorkspaceLabel {
				hasLabel = true
				break
			}
		}
		if !hasLabel {
			continue
		}
		changed := false
		if workspaces[i].Labels == nil || len(workspaces[i].Labels) == 0 {
			workspaces[i].Labels = []string{HomeWorkspaceLabel}
			changed = true
		}
		// Restore the label if it was dropped but the record is still recognisably Home by
		// directory; handled below. A titled record keeps the user's title.
		if changed {
			_ = writeJSONArray(s.workspacesPath(), workspaces)
		}
		return nil
	}

	// No record carries the label. If one lives at the Home directory, re-badge it instead of
	// creating a duplicate.
	for i := range workspaces {
		if filepath.Clean(workspaces[i].Cwd) != filepath.Clean(homeCwd) || workspaces[i].ArchivedAt != nil {
			continue
		}
		workspaces[i].Labels = append(workspaces[i].Labels, HomeWorkspaceLabel)
		for j := range projects {
			if projects[j].ProjectID == workspaces[i].ProjectID && projects[j].CustomName == nil {
				customName := HomeProjectName
				projects[j].CustomName = &customName
				_ = writeJSONArray(s.projectsPath(), projects)
				break
			}
		}
		return writeJSONArray(s.workspacesPath(), workspaces)
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	customName := HomeProjectName
	prjKey := "host:" + serverID + ":" + homeCwd
	var prjID string
	for i := range projects {
		if projects[i].RootPath == homeCwd && projects[i].ArchivedAt == nil {
			prjID = projects[i].ProjectID
			if projects[i].CustomName == nil {
				projects[i].CustomName = &customName
				_ = writeJSONArray(s.projectsPath(), projects)
			}
			break
		}
	}
	if prjID == "" {
		prj := ProjectRecord{
			ProjectID:   NewProjectID(),
			RootPath:    homeCwd,
			Kind:        "directory",
			DisplayName: HomeWorkspaceDirName,
			ProjectKey:  &prjKey,
			CustomName:  &customName,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		projects = append(projects, prj)
		_ = writeJSONArray(s.projectsPath(), projects)
		prjID = prj.ProjectID
	}

	title := HomeWorkspaceTitle
	ws := WorkspaceRecord{
		WorkspaceID: NewWorkspaceID(),
		ProjectID:   prjID,
		Cwd:         homeCwd,
		Kind:        "directory",
		DisplayName: HomeWorkspaceDirName,
		Title:       &title,
		Labels:      []string{HomeWorkspaceLabel},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	workspaces = append([]WorkspaceRecord{ws}, workspaces...)
	return writeJSONArray(s.workspacesPath(), workspaces)
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

	// An archived workspace at this path is the one the user means when they open it: bring it
	// back rather than creating a second workspace for a directory that already has one. Without
	// this, opening an archived workspace leaves the archive entry in place and adds a duplicate
	// — the sidebar grows a second row for the same directory every time.
	for i := range workspaces {
		ws := workspaces[i]
		if ws.ArchivedAt == nil || ws.Cwd != absCwd {
			continue
		}
		var owningProject *ProjectRecord
		for j := range projects {
			if projects[j].ProjectID == ws.ProjectID {
				owningProject = &projects[j]
				break
			}
		}
		if owningProject == nil {
			// An orphaned workspace record whose project is gone: creating a fresh one is the
			// only coherent answer.
			continue
		}
		if owningProject.ArchivedAt != nil {
			// The project itself is archived. Reopening a single workspace would leave it in an
			// archived project that the sidebar does not render.
			unarchivedProject := *owningProject
			unarchivedProject.ArchivedAt = nil
			unarchivedProject.UpdatedAt = now
			if err := s.UpsertProject(unarchivedProject); err == nil {
				*owningProject = unarchivedProject
			}
		}
		ws.ArchivedAt = nil
		ws.UpdatedAt = now
		if err := s.UpsertWorkspace(ws); err != nil {
			return ProjectRecord{}, WorkspaceRecord{}, err
		}
		return *owningProject, ws, nil
	}

	var matchedProject *ProjectRecord
	for i := range projects {
		if projects[i].ArchivedAt == nil && projects[i].RootPath == absCwd {
			matchedProject = &projects[i]
			break
		}
	}
	if matchedProject == nil {
		repoRoot := gitRepoRoot(absCwd)
		kind := "non_git"
		remoteURL := ""
		if repoRoot != "" {
			kind = "git"
			remoteURL = gitRemoteURL(absCwd)
		}
		prjKey := projectkey.Derive(absCwd, remoteURL, repoRoot, "", s.serverID)
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
		DisplayName:  DeriveWorkspaceDisplayName(absCwd),
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

// FindOrCreateProjectForDirectory returns the project that owns cwd, creating only the project.
//
// This is the split Node makes: `findOrCreateProjectForDirectory` adds a project, and a
// workspace appears only when the user opens or creates one. Keeping the two together makes
// "add project" silently produce an empty workspace, which the sidebar then shows as a
// project with content the user never asked for.
func (s *Store) FindOrCreateProjectForDirectory(cwd string) (ProjectRecord, error) {
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		absCwd = cwd
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	baseName := filepath.Base(absCwd)
	if baseName == "" || baseName == "/" || baseName == "." {
		baseName = "project"
	}

	projects, err := s.ListProjects()
	if err != nil {
		return ProjectRecord{}, err
	}
	for i := range projects {
		if projects[i].ArchivedAt == nil && projects[i].RootPath == absCwd {
			return projects[i], nil
		}
	}

	// A project's directory is not necessarily a repository root: `packages/app` inside a repo
	// is a project too. Asking git for the containing root is what makes "root vs subdirectory"
	// distinguishable in the derived key.
	repoRoot := gitRepoRoot(absCwd)
	kind := "non_git"
	remoteURL := ""
	if repoRoot != "" {
		kind = "git"
		remoteURL = gitRemoteURL(absCwd)
	}
	prjKey := projectkey.Derive(absCwd, remoteURL, repoRoot, "", s.serverID)
	record := ProjectRecord{
		ProjectID:   NewProjectID(),
		RootPath:    absCwd,
		Kind:        kind,
		DisplayName: baseName,
		ProjectKey:  &prjKey,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.UpsertProject(record); err != nil {
		return ProjectRecord{}, err
	}
	return record, nil
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

// LabelDefinition represents a persisted workspace label in $BYSPACE_HOME/projects/labels.json.
type LabelDefinition struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (s *Store) labelsPath() string {
	return filepath.Join(s.homeDir, "projects", "labels.json")
}

// ListLabels returns all persisted workspace label definitions.
func (s *Store) ListLabels() ([]LabelDefinition, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadLabelCatalogLocked().Labels, nil
}

// SetWorkspaceLabelAssignment assigns or removes a label from a workspace and ensures the label exists in the catalog.
func (s *Store) SetWorkspaceLabelAssignment(workspaceID string, lbl LabelDefinition, assigned bool) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if lbl.Color == "" {
		lbl.Color = "blue"
	}
	labels, _ := readJSONArray[LabelDefinition](s.labelsPath())
	found := false
	for i := range labels {
		if labels[i].Name == lbl.Name {
			labels[i].Color = lbl.Color
			found = true
			break
		}
	}
	if !found && lbl.Name != "" {
		labels = append(labels, lbl)
	}
	_ = writeJSONArray(s.labelsPath(), labels)

	workspaces, err := readJSONArray[WorkspaceRecord](s.workspacesPath())
	if err != nil {
		return []string{}, err
	}
	var updatedLabels []string
	for i := range workspaces {
		if workspaces[i].WorkspaceID == workspaceID {
			cur := workspaces[i].Labels
			next := make([]string, 0, len(cur)+1)
			has := false
			for _, name := range cur {
				if name == lbl.Name {
					has = true
					if assigned {
						next = append(next, name)
					}
				} else {
					next = append(next, name)
				}
			}
			if assigned && !has && lbl.Name != "" {
				next = append(next, lbl.Name)
			}
			workspaces[i].Labels = next
			updatedLabels = next
			break
		}
	}
	_ = writeJSONArray(s.workspacesPath(), workspaces)
	if updatedLabels == nil {
		updatedLabels = []string{}
	}
	return updatedLabels, nil
}

// UpdateLabel updates a label's name and/or color across the catalog and all workspaces.
func (s *Store) UpdateLabel(name, newName, color string) (LabelDefinition, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	targetName := strings.TrimSpace(newName)
	if targetName == "" {
		targetName = name
	}
	targetColor := strings.TrimSpace(color)
	if targetColor == "" {
		targetColor = "blue"
	}

	labels, _ := readJSONArray[LabelDefinition](s.labelsPath())
	updatedDef := LabelDefinition{Name: targetName, Color: targetColor}
	found := false
	for i := range labels {
		if labels[i].Name == name {
			if strings.TrimSpace(color) == "" {
				updatedDef.Color = labels[i].Color
			}
			labels[i] = updatedDef
			found = true
			break
		}
	}
	if !found {
		labels = append(labels, updatedDef)
	}
	_ = writeJSONArray(s.labelsPath(), labels)

	workspaces, _ := readJSONArray[WorkspaceRecord](s.workspacesPath())
	affected := 0
	for i := range workspaces {
		changed := false
		for j, ln := range workspaces[i].Labels {
			if ln == name {
				workspaces[i].Labels[j] = targetName
				changed = true
			}
		}
		if changed {
			affected++
		}
	}
	if affected > 0 {
		_ = writeJSONArray(s.workspacesPath(), workspaces)
	}
	return updatedDef, affected, nil
}

// InspectLabelUsage counts how many workspaces currently carry the given label name.
func (s *Store) InspectLabelUsage(name string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	workspaces, _ := readJSONArray[WorkspaceRecord](s.workspacesPath())
	count := 0
	for _, w := range workspaces {
		for _, ln := range w.Labels {
			if ln == name {
				count++
				break
			}
		}
	}
	return count
}

// DeleteLabel removes a label from the catalog and strips it from all workspaces.
func (s *Store) DeleteLabel(name string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	catalog := s.loadLabelCatalogLocked()
	nextLabels := make([]LabelDefinition, 0, len(catalog.Labels))
	for _, l := range catalog.Labels {
		if l.Name != name {
			nextLabels = append(nextLabels, l)
		}
	}
	catalog.Labels = nextLabels
	s.saveLabelCatalogLocked(catalog)

	workspaces, _ := readJSONArray[WorkspaceRecord](s.workspacesPath())
	affected := 0
	for i := range workspaces {
		next := make([]string, 0, len(workspaces[i].Labels))
		removed := false
		for _, ln := range workspaces[i].Labels {
			if ln == name {
				removed = true
			} else {
				next = append(next, ln)
			}
		}
		if removed {
			workspaces[i].Labels = next
			affected++
		}
	}
	if affected > 0 {
		_ = writeJSONArray(s.workspacesPath(), workspaces)
	}
	return affected
}

// LoadDaemonConfig returns the flattened daemon config.
//
// On disk the file is `{"version": 1, "daemon": { ... }}` (PersistedConfigSchema in
// archive/packages/server/src/server/persisted-config.ts). Node always reads
// `persisted.daemon.<key>`; reading the root instead silently drops every user setting
// (appendSystemPrompt, cors, terminalAgentHooks, ...). This merges `daemon` over the
// defaults and keeps unknown keys so a round-trip through SaveDaemonConfig does not
// erase sections the Go side does not model yet.
func (s *Store) LoadDaemonConfig() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg := daemonConfigDefaults()
	b, err := os.ReadFile(filepath.Join(s.homeDir, "config.json"))
	if err != nil {
		return cfg
	}
	var disk map[string]any
	if json.Unmarshal(b, &disk) != nil {
		return cfg
	}
	// `daemon` is where every real setting lives. A root-level key is honoured only when
	// `daemon` does not carry the same one, which keeps hand-written configs working.
	for k, v := range disk {
		if k == "version" || k == "daemon" {
			continue
		}
		cfg[k] = v
	}
	if daemon, ok := disk["daemon"].(map[string]any); ok {
		for k, v := range daemon {
			cfg[k] = v
		}
	}
	// `passwordSet` is derived, not stored: the hash is the truth, and a stored boolean could
	// drift from it (a hand-edited config, a failed write) leaving the settings page claiming a
	// password exists when it does not — or worse, the reverse.
	auth, _ := cfg["auth"].(map[string]any)
	hash, _ := auth["passwordHash"].(string)
	if merged, ok := cfg["auth"].(map[string]any); ok {
		merged["passwordSet"] = strings.TrimSpace(hash) != ""
	} else {
		cfg["auth"] = map[string]any{"passwordSet": strings.TrimSpace(hash) != ""}
	}
	return cfg
}

func daemonConfigDefaults() map[string]any {
	return map[string]any{
		"mcp": map[string]any{
			"enabled":          true,
			"injectIntoAgents": true,
		},
		"providers":                map[string]any{},
		"metadataGeneration":       map[string]any{"providers": []any{}},
		"autoArchiveAfterMerge":    false,
		"enableTerminalAgentHooks": false,
		"terminalAgentHooks":       map[string]bool{},
		"appendSystemPrompt":       "",
		"agentProfiles":            []any{},
		"cors":                     map[string]any{"allowedOrigins": []any{}},
		"network": map[string]any{
			"allowLanAccess": false,
			"tcpPort":        6778,
		},
		"auth": map[string]any{
			"passwordSet": false,
		},
		"tunnel": map[string]any{
			"enabled":      false,
			"allowedPorts": []int{},
		},
	}
}

// SaveDaemonConfig merges patch into the `daemon` section of $BYSPACE_HOME/config.json
// and returns the resulting flattened config.
func (s *Store) SaveDaemonConfig(patch map[string]any) map[string]any {
	cur := s.LoadDaemonConfig()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range patch {
		cur[k] = v
	}

	cfgPath := filepath.Join(s.homeDir, "config.json")
	disk := map[string]any{"version": 1, "daemon": map[string]any{}}
	if b, err := os.ReadFile(cfgPath); err == nil {
		var existing map[string]any
		if json.Unmarshal(b, &existing) == nil {
			disk = existing
			if _, ok := disk["version"]; !ok {
				disk["version"] = 1
			}
		}
	}
	daemon, _ := disk["daemon"].(map[string]any)
	if daemon == nil {
		daemon = map[string]any{}
	}
	for k, v := range patch {
		daemon[k] = v
	}
	disk["daemon"] = daemon

	b, _ := json.MarshalIndent(disk, "", "  ")
	_ = home.WriteAtomic(cfgPath, append(b, '\n'), 0o600)
	return cur
}

// CORSAllowedOrigins resolves the origins the daemon should answer cross-origin for:
// `config.daemon.cors.allowedOrigins` plus the comma-separated BYSPACE_CORS_ORIGINS.
func (s *Store) CORSAllowedOrigins() []string {
	seen := map[string]bool{}
	out := make([]string, 0)
	add := func(origin string) {
		trimmed := strings.TrimSpace(origin)
		if trimmed == "" || seen[trimmed] {
			return
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}

	if cors, ok := s.LoadDaemonConfig()["cors"].(map[string]any); ok {
		if origins, ok := cors["allowedOrigins"].([]any); ok {
			for _, o := range origins {
				if str, ok := o.(string); ok {
					add(str)
				}
			}
		}
	}
	for _, origin := range strings.Split(os.Getenv("BYSPACE_CORS_ORIGINS"), ",") {
		add(origin)
	}
	return out
}

// SaveProjectIcon persists a custom project icon under $BYSPACE_HOME/projects/icons/<projectId>.json.
func (s *Store) SaveProjectIcon(projectID string, icon map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := filepath.Join(s.homeDir, "projects", "icons", projectID+".json")
	if icon == nil {
		_ = os.Remove(p)
		return nil
	}
	b, err := json.MarshalIndent(icon, "", "  ")
	if err != nil {
		return err
	}
	return home.WriteAtomic(p, append(b, '\n'), 0o600)
}

// LoadProjectIcon reads a custom project icon if present.
func (s *Store) LoadProjectIcon(projectID string) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := filepath.Join(s.homeDir, "projects", "icons", projectID+".json")
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var out map[string]any
	if json.Unmarshal(b, &out) != nil {
		return nil
	}
	return out
}

// LabelCatalog is the persisted label set plus the monotonic counters the client replica
// needs. The app's host-replica applies `workspace.label.update` frames only when
// `update.seq === cursor.afterSeq + 1` within the same generation, so both numbers have to
// advance for every catalog mutation.
type LabelCatalog struct {
	Generation string            `json:"generation"`
	HeadSeq    int               `json:"headSeq"`
	Labels     []LabelDefinition `json:"labels"`
}

func (s *Store) labelCatalogPath() string {
	return filepath.Join(s.homeDir, "projects", "labels.json")
}

// LoadLabelCatalog returns the catalog, bootstrapping a generation on first read.
func (s *Store) LoadLabelCatalog() LabelCatalog {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadLabelCatalogLocked()
}

func (s *Store) loadLabelCatalogLocked() LabelCatalog {
	b, err := os.ReadFile(s.labelCatalogPath())
	if err != nil {
		return LabelCatalog{Generation: "gen_1", HeadSeq: 0, Labels: []LabelDefinition{}}
	}
	// Older files were a bare array; the catalog shape is a superset that also reads those.
	var catalog LabelCatalog
	if json.Unmarshal(b, &catalog) == nil && catalog.Generation != "" {
		if catalog.Labels == nil {
			catalog.Labels = []LabelDefinition{}
		}
		return catalog
	}
	var legacy []LabelDefinition
	if json.Unmarshal(b, &legacy) == nil {
		return LabelCatalog{Generation: "gen_1", HeadSeq: len(legacy), Labels: legacy}
	}
	return LabelCatalog{Generation: "gen_1", HeadSeq: 0, Labels: []LabelDefinition{}}
}

func (s *Store) saveLabelCatalogLocked(catalog LabelCatalog) {
	b, _ := json.MarshalIndent(catalog, "", "  ")
	_ = home.WriteAtomic(s.labelCatalogPath(), append(b, '\n'), 0o600)
}

// MutateLabelCatalog applies a mutation and returns the catalog plus the update frame the
// client replica should receive. The caller broadcasts the frame.
func (s *Store) MutateLabelCatalog(mutate func(*LabelCatalog) (map[string]any, bool)) (LabelCatalog, map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catalog := s.loadLabelCatalogLocked()
	update, changed := mutate(&catalog)
	if !changed {
		return catalog, nil
	}
	catalog.HeadSeq++
	if update != nil {
		update["generation"] = catalog.Generation
		update["seq"] = catalog.HeadSeq
	}
	s.saveLabelCatalogLocked(catalog)
	return catalog, update
}

// gitRemoteURL reads origin's URL for the repository at repoPath, or "" when there is none.
func gitRemoteURL(repoPath string) string {
	out, err := exec.Command("git", "-C", repoPath, "config", "--get", "remote.origin.url").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// SetServerID records the daemon's own identity for project-key derivation.
func (s *Store) SetServerID(serverID string) {
	s.mu.Lock()
	s.serverID = serverID
	s.mu.Unlock()
}

// gitRepoRoot returns the repository root that contains repoPath, or "" when it is not in a
// repository. The value feeds project-key derivation: a repo root and one of its subdirectories
// are different projects (`#subdir:` suffix), while being the root itself is not.
func gitRepoRoot(repoPath string) string {
	out, err := exec.Command("git", "-C", repoPath, "rev-parse", "--show-toplevel").Output()
	if err == nil {
		if root := strings.TrimSpace(string(out)); root != "" {
			return root
		}
	}
	// A directory holding a `.git` entry is a repository root even when the git binary is
	// missing or the entry is a plain directory (worktrees, fixtures).
	if _, statErr := os.Stat(filepath.Join(repoPath, ".git")); statErr == nil {
		return repoPath
	}
	return ""
}

// BackfillProjectKeys re-derives projectKey for records that predate key derivation.
//
// Node reconciles persisted projects on boot: a record without a key cannot join a cross-host
// group, so two checkouts of one repository show up as two projects until the key is filled in.
// Doing it at startup means an existing home keeps working after an upgrade.
func (s *Store) BackfillProjectKeys() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	projects, err := readJSONArray[ProjectRecord](s.projectsPath())
	if err != nil {
		return 0
	}
	changed := 0
	for i := range projects {
		if projects[i].ProjectKey != nil && strings.TrimSpace(*projects[i].ProjectKey) != "" {
			continue
		}
		repoRoot := gitRepoRoot(projects[i].RootPath)
		remoteURL := ""
		if repoRoot != "" {
			remoteURL = gitRemoteURL(projects[i].RootPath)
		}
		derived := projectkey.Derive(projects[i].RootPath, remoteURL, repoRoot, "", s.serverID)
		projects[i].ProjectKey = &derived
		changed++
	}
	if changed > 0 {
		_ = writeJSONArray(s.projectsPath(), projects)
	}
	return changed
}

// ResolveWorkspaceIDForPath maps a bare filesystem path to one workspace.
//
// Ported from resolve-workspace-id-for-path.ts. Callers pass a path with no id (archive-by-path,
// auto-archive-after-merge, the MCP archive tool), and the rule is: an exact directory match
// wins, otherwise the **deepest** enclosing workspace, and never the user's home directory
// (which would swallow every path).
func (s *Store) ResolveWorkspaceIDForPath(cwd string) string {
	list, err := s.ListWorkspaces()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return ""
	}
	resolved := filepath.Clean(cwd)

	// Exact match goes through path equivalence, not string equality: the same directory can
	// arrive as /tmp/x or /private/tmp/x (macOS symlink), with a trailing separator, or with
	// different case. A string comparison reports the path as unowned, and the caller creates a
	// second workspace for a directory it already has one for.
	for _, ws := range list {
		if pathutil.AreEquivalent(ws.Cwd, resolved) {
			return ws.WorkspaceID
		}
	}

	homeDir, _ := os.UserHomeDir()
	bestLen := 0
	bestID := ""
	for _, ws := range list {
		if ws.ArchivedAt != nil {
			continue
		}
		wsCwd := filepath.Clean(ws.Cwd)
		if homeDir != "" && wsCwd == filepath.Clean(homeDir) {
			continue
		}
		prefix := wsCwd
		if !strings.HasSuffix(prefix, string(filepath.Separator)) {
			prefix += string(filepath.Separator)
		}
		if !strings.HasPrefix(resolved, prefix) {
			continue
		}
		if len(wsCwd) > bestLen {
			bestLen = len(wsCwd)
			bestID = ws.WorkspaceID
		}
	}
	return bestID
}

// RebuildWorkspaceRegistryFromAgents recreates the workspace registry from agent records.
//
// Ported from bootstrapWorkspaceRegistries. The registry can be lost while agent records survive
// (a partial home copy, a failed write, an old install upgraded in place). Without this the
// sidebar shows nothing and every agent becomes unreachable, even though its session file and
// history are intact.
//
// Only agents whose working directory still exists are considered: a missing directory cannot be
// registered, and inventing a workspace for it would put an entry in the sidebar that fails the
// moment it is opened.
func (s *Store) RebuildWorkspaceRegistryFromAgents() (int, error) {
	workspaces, err := s.ListWorkspaces()
	if err != nil {
		return 0, err
	}
	if len(workspaces) > 0 {
		// Registry is intact; nothing to rebuild.
		return 0, nil
	}

	agents, err := s.ListAgents()
	if err != nil {
		return 0, err
	}

	type candidate struct {
		cwd       string
		createdAt string
		updatedAt string
	}
	byDir := make(map[string]*candidate)
	for _, rec := range agents {
		if rec.ArchivedAt != nil || strings.TrimSpace(rec.Cwd) == "" {
			continue
		}
		info, statErr := os.Stat(rec.Cwd)
		if statErr != nil || !info.IsDir() {
			continue
		}
		resolved := filepath.Clean(rec.Cwd)
		existing, ok := byDir[resolved]
		if !ok {
			byDir[resolved] = &candidate{cwd: resolved, createdAt: rec.CreatedAt, updatedAt: rec.UpdatedAt}
			continue
		}
		// The workspace takes the earliest creation and the latest activity across its agents.
		if rec.CreatedAt != "" && (existing.createdAt == "" || rec.CreatedAt < existing.createdAt) {
			existing.createdAt = rec.CreatedAt
		}
		if rec.UpdatedAt > existing.updatedAt {
			existing.updatedAt = rec.UpdatedAt
		}
	}

	// Sorted so a rebuild is deterministic instead of following map order.
	dirs := make([]string, 0, len(byDir))
	for dir := range byDir {
		dirs = append(dirs, dir)
	}
	sort.Strings(dirs)

	created := 0
	for _, dir := range dirs {
		c := byDir[dir]
		if _, _, err := s.EnsureWorkspaceForCwd(c.cwd); err != nil {
			continue
		}
		created++
	}
	return created, nil
}

// UntrustedSource records the change request a workspace was checked out from.
//
// It lives here rather than in the workspace package because the record is what persists it, and
// the workspace package already depends on the store.
type UntrustedSource struct {
	Kind           string `json:"kind"` // "change_request"
	Forge          string `json:"forge"`
	Number         int    `json:"number"`
	HeadRepository string `json:"headRepository"`
}

// IsBlocked reports whether automation must be refused for this source.
//
// A missing head repository means the change request came from this repository, which the user
// already trusts — only a cross-repository checkout blocks.
func (s *UntrustedSource) IsBlocked() bool {
	return s != nil && s.Kind == "change_request" && s.HeadRepository != ""
}

// DeriveWorkspaceDisplayName names a workspace for the sidebar.
//
// Ported from workspace-registry-model.ts. A checkout shows its branch, because that is how the
// user tells two checkouts of the same repository apart; a detached HEAD or a non-git directory
// falls back to the directory name, since "HEAD" is not a name.
func DeriveWorkspaceDisplayName(cwd string) string {
	if branch, err := gitCurrentBranch(cwd); err == nil {
		if trimmed := strings.TrimSpace(branch); trimmed != "" && !strings.EqualFold(trimmed, "HEAD") {
			return trimmed
		}
	}
	cleaned := strings.ReplaceAll(strings.TrimSpace(cwd), "\\", "/")
	segments := make([]string, 0, 4)
	for _, seg := range strings.Split(cleaned, "/") {
		if seg != "" {
			segments = append(segments, seg)
		}
	}
	if len(segments) == 0 {
		return cwd
	}
	return segments[len(segments)-1]
}

// gitCurrentBranch reports the checked-out branch, or "" when detached.
//
// Separate from gitRepoRoot because a failure to read the branch must not make the repository
// look like a non-repository.
func gitCurrentBranch(repoPath string) (string, error) {
	out, err := exec.Command("git", "-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// UnarchiveAgent clears an agent's archive marker.
//
// Returns the updated record, or nil when the agent is missing or was not archived. Ported from
// unarchiveSnapshot: sending a message to an archived agent brings it back, because the archive is a
// tidy-up rather than a tombstone.
//
// The status is reset to idle: an archived agent was normalized to idle on the way in (see
// BuildArchivedAgentRecord), and leaving a stale "closed" would make the sidebar show a dead agent
// until the first turn completed.
func (s *Store) UnarchiveAgent(agentID string) (*AgentRecord, error) {
	// The public accessors rather than lock-held variants: they take the lock themselves, and a
	// *Locked variant called from here would deadlock on a non-reentrant mutex.
	record, err := s.GetAgent(agentID)
	if err != nil {
		return nil, err
	}
	if record == nil || record.ArchivedAt == nil {
		return nil, nil
	}
	updated := *record
	updated.ArchivedAt = nil
	updated.LastStatus = "idle"
	updated.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.UpsertAgent(updated); err != nil {
		return nil, err
	}
	return &updated, nil
}

// ListByProviderSession finds agents sharing a provider session handle.
//
// Ported from agent-storage's listByProviderSession. A provider session file can back more than one
// agent record — a fork, or a resume that created a second record — and importing a session has to know
// about all of them or it will offer a session that is already in use.
func (s *Store) ListByProviderSession(provider, sessionID string) ([]AgentRecord, error) {
	agents, err := s.ListAgents()
	if err != nil {
		return nil, err
	}
	trimmedProvider := strings.TrimSpace(provider)
	trimmedSession := strings.TrimSpace(sessionID)
	out := make([]AgentRecord, 0, 1)
	for _, agent := range agents {
		if agent.Persistence == nil {
			continue
		}
		if trimmedProvider != "" && agent.Persistence.Provider != trimmedProvider {
			continue
		}
		handle := strings.TrimSpace(agent.Persistence.SessionID)
		if handle == trimmedSession || fmt.Sprint(agent.Persistence.NativeHandle) == trimmedSession {
			out = append(out, agent)
		}
	}
	return out, nil
}

// ListByWorkspace finds the agents in a workspace.
func (s *Store) ListByWorkspace(workspaceID string) ([]AgentRecord, error) {
	agents, err := s.ListAgents()
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(workspaceID)
	out := make([]AgentRecord, 0, 4)
	for _, agent := range agents {
		if agent.WorkspaceID == trimmed {
			out = append(out, agent)
		}
	}
	return out, nil
}
