package chief

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// ClaimSharedLocks validates concrete changed files before changing any lock.
func ClaimSharedLocks(m *Mission, threadID string, paths []string) error {
	if m == nil {
		return &OwnershipError{ThreadID: threadID, Violations: []string{"mission is nil"}}
	}
	var thread *Thread
	for i := range m.Threads {
		if m.Threads[i].ID == threadID {
			thread = &m.Threads[i]
			break
		}
	}
	if thread == nil {
		return fmt.Errorf("%w: %s", ErrThreadNotFound, threadID)
	}

	violations := make([]string, 0)
	if len(paths) == 0 {
		violations = append(violations, "at least one changed path is required")
	}
	if m.Tier == TierL2 && len(thread.OwnedPaths) == 0 {
		violations = append(violations, "L2 thread has no owned paths")
	}

	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, raw := range paths {
		p, err := concreteLockPath(raw)
		if err != nil {
			violations = append(violations, err.Error())
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		normalized = append(normalized, p)

		if !IsPathOwned(p, thread.OwnedPaths, m.SharedLocks, threadID) {
			violations = append(violations, fmt.Sprintf("%s is not owned by %s", p, threadID))
		}
		for _, other := range m.Threads {
			if other.ID == threadID || len(other.OwnedPaths) == 0 {
				continue
			}
			switch other.Status {
			case ThreadStatusLanded, ThreadStatusCanceled, ThreadStatusFailed:
				continue
			}
			if IsPathOwned(p, other.OwnedPaths, nil, other.ID) {
				violations = append(violations, fmt.Sprintf("%s is owned by %s", p, other.ID))
			}
		}
		if holder := m.SharedLocks[p]; holder != "" && holder != threadID {
			violations = append(violations, fmt.Sprintf("%s is locked by %s", p, holder))
		}
	}
	if len(violations) > 0 {
		sort.Strings(violations)
		return &OwnershipError{ThreadID: threadID, Violations: violations}
	}

	if m.SharedLocks == nil {
		m.SharedLocks = make(map[string]string, len(normalized))
	}
	sort.Strings(normalized)
	for _, p := range normalized {
		m.SharedLocks[p] = threadID
	}
	return nil
}

func concreteLockPath(raw string) (string, error) {
	if raw == "" {
		return "", fmt.Errorf("changed path is empty")
	}
	if strings.IndexByte(raw, 0) >= 0 {
		return "", fmt.Errorf("changed path contains NUL")
	}
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, `\`) || filepath.IsAbs(raw) || filepath.VolumeName(raw) != "" ||
		(len(raw) >= 2 && raw[1] == ':') {
		return "", fmt.Errorf("changed path must be relative: %s", raw)
	}
	slashed := strings.ReplaceAll(raw, `\`, "/")
	if strings.HasSuffix(slashed, "/") {
		return "", fmt.Errorf("changed path is not a file: %s", raw)
	}
	for _, part := range strings.Split(slashed, "/") {
		if part == ".." {
			return "", fmt.Errorf("changed path escapes the workspace: %s", raw)
		}
	}
	if strings.ContainsAny(slashed, "*?[") {
		return "", fmt.Errorf("changed path must be concrete: %s", raw)
	}
	p := normalizeRelPath(slashed)
	if p == "" || p == "." {
		return "", fmt.Errorf("changed path is not a file: %s", raw)
	}
	return p, nil
}

// ReleaseSharedLocks releases only locks held by threadID.
func ReleaseSharedLocks(m *Mission, threadID string) {
	if m == nil {
		return
	}
	for p, owner := range m.SharedLocks {
		if owner == threadID {
			delete(m.SharedLocks, p)
		}
	}
}
