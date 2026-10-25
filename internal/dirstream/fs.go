package dirstream

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func resolveDir(inputPath string) (string, bool) {
	resolved, ok := realPath(filepath.Clean(inputPath))
	if !ok {
		return "", false
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", false
	}
	return resolved, true
}

func realPath(path string) (string, bool) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", false
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return "", false
	}
	return abs, true
}

func entryKind(path string) (Kind, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return "", false
	}
	if info.IsDir() {
		return KindDirectory, true
	}
	return KindFile, true
}

func isInsideRoot(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func readChildren(directory string) []childEntry {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil
	}
	out := make([]childEntry, 0, len(entries))
	for _, entry := range entries {
		full := filepath.Join(directory, entry.Name())
		resolved, ok := realPath(full)
		if !ok {
			continue
		}
		kind, ok := entryKind(resolved)
		if !ok {
			continue
		}
		out = append(out, childEntry{name: entry.Name(), resolvedPath: resolved, kind: kind})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out
}

func normalizeRelative(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return "."
	}
	return filepath.ToSlash(rel)
}

func formatPath(path, root string, format PathFormat) string {
	if format == FormatAbsolute {
		return path
	}
	return normalizeRelative(root, path)
}

func parseQuery(
	query, root, configuredRoot string,
	policy PathQueryPolicy,
	aliases []string,
	blank BlankQueryBehavior,
) (queryPlan, bool) {
	typed := strings.TrimSpace(strings.ReplaceAll(query, "\\", "/"))
	normalized := typed
	rooted := false
	isAbsolute := false

	for _, alias := range aliases {
		if normalized == alias || strings.HasPrefix(normalized, alias+"/") {
			rooted = true
			normalized = strings.TrimLeft(strings.TrimPrefix(normalized, alias), "/")
			break
		}
	}

	if filepath.IsAbs(normalized) {
		isAbsolute = true
		browseAbsoluteDirectory := strings.HasSuffix(normalized, "/")
		absolutePath := filepath.Clean(normalized)
		queryRoot := ""
		if isInsideRoot(root, absolutePath) {
			queryRoot = root
		} else if isInsideRoot(configuredRoot, absolutePath) {
			queryRoot = configuredRoot
		}
		if queryRoot == "" {
			return queryPlan{}, false
		}
		rooted = true
		normalized = normalizeRelative(queryRoot, absolutePath)
		if browseAbsoluteDirectory && normalized != "." {
			normalized += "/"
		}
	}

	if strings.HasPrefix(normalized, "./") {
		rooted = true
	}
	normalized = strings.TrimPrefix(normalized, "./")
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	if normalized == "." && (rooted || typed == ".") {
		normalized = ""
	}

	if normalized == "" {
		explicitlyBrowseRoot := rooted || typed == "."
		if !explicitlyBrowseRoot && blank != BlankChildren {
			return queryPlan{}, false
		}
		return queryPlan{isPathQuery: true}, true
	}

	if isAbsolute && isFilesystemRoot(root) && !strings.Contains(normalized, "/") {
		return queryPlan{
			isPathQuery:     true,
			parentPart:      normalized,
			normalizedQuery: normalized,
			browseExactPath: true,
		}, true
	}

	isPathQuery := rooted || (policy == PolicySlashes && strings.Contains(normalized, "/"))
	slash := strings.LastIndex(normalized, "/")
	plan := queryPlan{isPathQuery: isPathQuery, normalizedQuery: normalized}
	if isPathQuery && slash >= 0 {
		plan.parentPart = normalized[:slash]
		plan.searchTerm = normalized[slash+1:]
	} else {
		plan.searchTerm = normalized
	}
	return plan, true
}

func isFilesystemRoot(path string) bool {
	cleaned := filepath.Clean(path)
	return filepath.Dir(cleaned) == cleaned
}
