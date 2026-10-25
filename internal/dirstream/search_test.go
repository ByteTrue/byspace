package dirstream

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTree(t *testing.T, root string, dirs []string, files []string) {
	t.Helper()
	for _, dir := range dirs {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range files {
		full := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func paths(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, entry := range entries {
		out[i] = entry.Path
	}
	return out
}

// Discovery must reach nested directories, which is the whole reason this is a tree walk
// rather than a readdir of one level.
func TestSearchFindsNestedDirectoryByName(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{"packages/app/src/components/file-drop", "packages/server/src"}, nil)

	results := Search(Options{
		Root:                            root,
		Query:                           "compo",
		PathFormat:                      FormatRelative,
		IncludeDirectories:              true,
		TraversableHiddenDirectoryNames: WorkspaceSearchHiddenDirectories,
	})
	if len(results) == 0 {
		t.Fatal("expected the nested components directory to be found from a prefix")
	}
	found := false
	for _, entry := range results {
		if entry.Path == "packages/app/src/components" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected packages/app/src/components in %v", paths(results))
	}
}

// Build output must never be offered: node_modules alone would swamp every query.
func TestSearchSkipsIgnoredDirectories(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{
		"node_modules/some-package",
		"dist/bundle",
		"vendor/lib",
		"src/modules",
	}, nil)

	results := Search(Options{
		Root:               root,
		Query:              "mod",
		PathFormat:         FormatRelative,
		IncludeDirectories: true,
	})
	for _, entry := range results {
		switch {
		case len(entry.Path) >= 12 && entry.Path[:12] == "node_modules":
			t.Fatalf("node_modules leaked into suggestions: %v", paths(results))
		case len(entry.Path) >= 4 && entry.Path[:4] == "dist":
			t.Fatalf("dist leaked into suggestions: %v", paths(results))
		}
	}
	if len(results) == 0 {
		t.Fatal("expected src/modules to be suggested")
	}
}

// An exact path the caller named is retrieval, not discovery: it must come back even when the
// path would be filtered during discovery.
func TestSearchReturnsExactNamedPath(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, nil, []string{"build/output.txt"})

	// suffix + path query is the retrieval path, which deliberately bypasses ignore rules:
	// the caller named this path, so containment is the only question left.
	results := Search(Options{
		Root:               root,
		Query:              "build/output.txt",
		PathFormat:         FormatRelative,
		IncludeFiles:       true,
		IncludeDirectories: false,
		MatchMode:          ModeSuffix,
	})
	if len(results) == 0 || results[0].Path != "build/output.txt" {
		t.Fatalf("expected the exact named path first, got %v", paths(results))
	}
}

// A blank query with BlankChildren lists the immediate children, which is what the picker shows
// when the field is empty.
func TestSearchBlankQueryListsChildren(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{"alpha", "beta", "gamma"}, nil)

	results := Search(Options{
		Root:               root,
		Query:              "",
		PathFormat:         FormatRelative,
		IncludeDirectories: true,
		BlankQueryBehavior: BlankChildren,
	})
	if len(results) != 3 {
		t.Fatalf("expected three children, got %v", paths(results))
	}
}

// Suffix mode compares whole trailing segments, used when the caller pasted a path fragment.
func TestSearchSuffixModeMatchesTrailingSegments(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{"client/team/widgets", "client/other"}, nil)

	results := Search(Options{
		Root:               root,
		Query:              "team/widgets",
		PathFormat:         FormatRelative,
		IncludeDirectories: true,
		MatchMode:          ModeSuffix,
	})
	if len(results) != 1 || results[0].Path != "client/team/widgets" {
		t.Fatalf("expected only client/team/widgets, got %v", paths(results))
	}
}

// A hidden callers' directory inside a workspace stays traversable, while other dot-dirs do not.
func TestSearchTraversesAllowlistedHiddenDirectories(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, []string{".claude/skills/review", ".secrets/vault"}, nil)

	results := Search(Options{
		Root:                            root,
		Query:                           "review",
		PathFormat:                      FormatRelative,
		IncludeDirectories:              true,
		TraversableHiddenDirectoryNames: WorkspaceSearchHiddenDirectories,
	})
	if len(results) != 1 || results[0].Path != ".claude/skills/review" {
		t.Fatalf("expected only the allowlisted .claude path, got %v", paths(results))
	}
}
