package server

import (
	"sync"

	"github.com/ByteTrue/byspace/internal/store"
	"github.com/ByteTrue/byspace/internal/workspace"
)

// withWorktreeLifecycle serializes activation and deletion of one checkout. Keep entries for the
// daemon lifetime: removing a mutex on unlock can split existing and new waiters across instances.
func (s *Server) withWorktreeLifecycle(path string, fn func() error) error {
	unlock := s.lockWorktreeLifecycle(path)
	defer unlock()
	return fn()
}

func (s *Server) lockWorktreeLifecycle(path string) func() {
	if ownership := workspace.ResolveWorktreeOwnership(s.worktreesBaseDir(), path); ownership.Owned {
		path = ownership.Path
	}
	key := worktreeCleanupKey(path)
	lock, _ := s.worktreeLifecycleLocks.LoadOrStore(key, &sync.Mutex{})
	mutex := lock.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

func (s *Server) ensureWorkspaceForCwd(cwd string) (store.ProjectRecord, store.WorkspaceRecord, error) {
	var project store.ProjectRecord
	var workspace store.WorkspaceRecord
	err := s.withWorktreeLifecycle(cwd, func() error {
		if s.beforeWorktreeWorkspaceRegister != nil {
			s.beforeWorktreeWorkspaceRegister(cwd)
		}
		var err error
		project, workspace, err = s.store.EnsureWorkspaceForCwd(cwd)
		return err
	})
	return project, workspace, err
}

func (s *Server) createWorkspaceForDirectory(cwd, title, sourceProjectID string) (store.ProjectRecord, store.WorkspaceRecord, error) {
	var project store.ProjectRecord
	var workspace store.WorkspaceRecord
	err := s.withWorktreeLifecycle(cwd, func() error {
		var err error
		project, workspace, err = s.store.CreateWorkspaceForDirectory(cwd, title, sourceProjectID)
		return err
	})
	return project, workspace, err
}
