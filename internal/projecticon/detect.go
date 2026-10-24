// Package projecticon finds a project's icon in its own files.
//
// Ported from utils/project-icon.ts. A project almost always ships a favicon or logo already;
// asking the user to upload one for a repository that has `public/favicon.svg` is busywork, and
// the sidebar looks unfinished until they do.
package projecticon

import (
	"os"
	"path/filepath"
	"strings"
)

// IconPatterns is the search order, most specific first.
//
// Order matters: a project that ships both `favicon.svg` and `logo.svg` means the favicon, and
// an `.svg` beats an `.ico` of the same name because it scales.
var IconPatterns = []string{
	"favicon.svg",
	"favicon.png",
	"favicon-*.svg",
	"favicon-*.png",
	"favico.svg",
	"favico.png",
	"icon.svg",
	"icon.png",
	"app-icon.svg",
	"app-icon.png",
	"apple-touch-icon.png",
	"apple-touch-icon-*.png",
	"icon-*.png",
	"android-chrome-*.png",
	"safari-pinned-tab.svg",
	"mstile-*.png",
	"logo.svg",
	"logo.png",
	"favicon.ico",
	"favico.ico",
}

// PriorityDirs are searched before a recursive scan: web projects keep their assets here.
var PriorityDirs = []string{"public", "static", "priv/static", "assets", "images", "img"}

// MonorepoDirs hold the actual apps.
var MonorepoDirs = []string{"packages", "apps"}

// IgnoredDirs are never descended into.
//
// Without this a single `node_modules` makes the scan take seconds and can surface a dependency's
// icon as the project's.
var IgnoredDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	".next": true, ".nuxt": true, "coverage": true, "vendor": true,
	"target": true, ".venv": true, "venv": true, "__pycache__": true,
	".turbo": true, ".cache": true, "out": true, ".output": true,
}

// MimeTypeFor maps an icon filename to its MIME type.
func MimeTypeFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".ico":
		return "image/x-icon"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

// Find returns the path of the best icon for a project directory, or "".
//
// Search order: priority directories, then monorepo packages, then a depth-limited recursive
// scan. The ordering means a repo-level `public/favicon.svg` wins over an app-level `logo.png`,
// which is what a user means by "the project's icon".
func Find(projectDir string) string {
	if strings.TrimSpace(projectDir) == "" {
		return ""
	}
	const maxDepth = 3

	if found := searchPriorityDirs(projectDir, maxDepth-1); found != "" {
		return found
	}
	for _, monoDir := range MonorepoDirs {
		monoPath := filepath.Join(projectDir, monoDir)
		entries, err := os.ReadDir(monoPath)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || IgnoredDirs[entry.Name()] {
				continue
			}
			packagePath := filepath.Join(monoPath, entry.Name())
			if found := searchPriorityDirs(packagePath, maxDepth-1); found != "" {
				return found
			}
			if found := findInDir(packagePath); found != "" {
				return found
			}
		}
	}
	return findRecursively(projectDir, maxDepth)
}

// searchPriorityDirs looks inside the well-known asset directories.
func searchPriorityDirs(base string, depth int) string {
	if depth < 0 {
		return ""
	}
	for _, dir := range PriorityDirs {
		candidate := filepath.Join(base, dir)
		info, err := os.Stat(candidate)
		if err != nil || !info.IsDir() {
			continue
		}
		if found := findInDir(candidate); found != "" {
			return found
		}
		// One level deeper covers `public/icons/favicon.svg` without walking an entire tree.
		if nested := findRecursively(candidate, depth); nested != "" {
			return nested
		}
	}
	return ""
}

// findInDir matches the icon patterns in one directory, in pattern order.
func findInDir(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	names := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			names[entry.Name()] = true
		}
	}
	for _, pattern := range IconPatterns {
		if !strings.Contains(pattern, "*") {
			if names[pattern] {
				return filepath.Join(dir, pattern)
			}
			continue
		}
		// Glob order is lexical, which is what gives `favicon-32.png` before `favicon-16.png`;
		// the largest is usually the one meant. Sort descending by name length to prefer it.
		best := ""
		for name := range names {
			matched, matchErr := filepath.Match(pattern, name)
			if matchErr != nil || !matched {
				continue
			}
			if len(name) > len(best) || (len(name) == len(best) && name < best) {
				best = name
			}
		}
		if best != "" {
			return filepath.Join(dir, best)
		}
	}
	return ""
}

// findRecursively walks up to `depth` levels, breadth-first so a shallow match wins.
func findRecursively(base string, depth int) string {
	if depth <= 0 {
		return ""
	}
	if found := findInDir(base); found != "" {
		return found
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if !entry.IsDir() || IgnoredDirs[entry.Name()] || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if found := findRecursively(filepath.Join(base, entry.Name()), depth-1); found != "" {
			return found
		}
	}
	return ""
}
