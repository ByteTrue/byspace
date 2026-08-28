package daemon

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type localCatalog struct {
	project   map[string]any
	workspace map[string]any
	provider  map[string]any
	fetchedAt string
}

func newLocalCatalog(workspaceRoot, piCommand string) (*localCatalog, error) {
	root, err := canonicalDirectory(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("workspace root: %w", err)
	}
	name := filepath.Base(root)
	projectID := stableCatalogID("prj", root)
	workspaceID := stableCatalogID("ws", root)
	projectKey := "directory:" + root
	project := map[string]any{
		"projectId":          projectID,
		"projectKey":         projectKey,
		"projectDisplayName": name,
		"projectRootPath":    root,
		"projectKind":        "directory",
	}
	liteCheckout := map[string]any{
		"cwd":                  root,
		"isGit":                false,
		"currentBranch":        nil,
		"remoteUrl":            nil,
		"isPaseoOwnedWorktree": false,
		"mainRepoRoot":         nil,
	}
	workspace := map[string]any{
		"id":                 workspaceID,
		"projectId":          projectID,
		"projectDisplayName": name,
		"projectRootPath":    root,
		"workspaceDirectory": root,
		"projectKind":        "directory",
		"workspaceKind":      "directory",
		"name":               name,
		"status":             "done",
		"statusEnteredAt":    nil,
		"activityAt":         nil,
		"scripts":            []any{},
		"gitRuntime":         nil,
		"githubRuntime":      nil,
		"project": map[string]any{
			"projectKey":    projectKey,
			"projectName":   name,
			"workspaceName": nil,
			"checkout":      liteCheckout,
		},
	}

	if piCommand == "" {
		piCommand = "pi"
	}
	status := "ready"
	var providerError any
	if _, err := exec.LookPath(piCommand); err != nil {
		status = "unavailable"
		providerError = fmt.Sprintf("%s executable not found on PATH", piCommand)
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339Nano)
	provider := map[string]any{
		"provider":      "pi",
		"status":        status,
		"enabled":       true,
		"source":        "builtin",
		"models":        []any{},
		"modes":         []any{},
		"fetchedAt":     fetchedAt,
		"label":         "Pi",
		"description":   "Pi coding agent",
		"defaultModeId": nil,
	}
	if providerError != nil {
		provider["error"] = providerError
	}
	return &localCatalog{
		project: project, workspace: workspace, provider: provider, fetchedAt: fetchedAt,
	}, nil
}

func canonicalDirectory(directory string) (string, error) {
	if directory == "" {
		var err error
		directory, err = os.Getwd()
		if err != nil {
			return "", err
		}
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", resolved)
	}
	return filepath.Clean(resolved), nil
}

func stableCatalogID(prefix, value string) string {
	sum := sha256.Sum256([]byte(value))
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(sum[:9])
}
