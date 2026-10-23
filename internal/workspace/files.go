package workspace

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const AccessOutsideWorkspaceErr = "Access outside of workspace is not allowed"

type Entry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"` // "file" | "directory"
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type DirectoryListing struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}

type FileContent struct {
	Path       string `json:"path"`
	Kind       string `json:"kind"`     // "text" | "image" | "binary"
	Encoding   string `json:"encoding"` // "utf-8" | "base64" | "none"
	Content    string `json:"content,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
	Revision   string `json:"revision"`
}

type FileVersion struct {
	Status     string `json:"status"` // "ready" | "missing" | "error"
	Cwd        string `json:"cwd"`
	Path       string `json:"path"`
	Size       int64  `json:"size,omitempty"`
	ModifiedAt string `json:"modifiedAt,omitempty"`
	Revision   string `json:"revision,omitempty"`
	Error      string `json:"error,omitempty"`
}

type FileWriteResult struct {
	Status     string       `json:"status"` // "written" | "conflict" | "error"
	ModifiedAt string       `json:"modifiedAt,omitempty"`
	Size       int64        `json:"size,omitempty"`
	Revision   string       `json:"revision,omitempty"`
	Version    *FileVersion `json:"version,omitempty"`
	Error      string       `json:"error,omitempty"`
}

var imageMimeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
}

func resolveScopedPath(root, rel string) (string, string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", "", err
	}
	if strings.TrimSpace(rel) == "" {
		rel = "."
	}
	target := filepath.Join(absRoot, rel)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", "", err
	}
	relToRoot, err := filepath.Rel(absRoot, absTarget)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(filepath.Separator)) {
		return "", "", errors.New(AccessOutsideWorkspaceErr)
	}
	normalizedRel := filepath.ToSlash(relToRoot)
	return absTarget, normalizedRel, nil
}

func fileRevision(info os.FileInfo) string {
	return fmt.Sprintf("%d:%d", info.Size(), info.ModTime().UnixNano())
}

// ListDirectory lists entries inside a workspace directory, sorted directories-first then alphabetically.
func ListDirectory(root, relPath string) (*DirectoryListing, error) {
	absTarget, normalizedRel, err := resolveScopedPath(root, relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absTarget)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("path is not a directory")
	}

	dirEntries, err := os.ReadDir(absTarget)
	if err != nil {
		return nil, err
	}

	entries := make([]Entry, 0, len(dirEntries))
	for _, de := range dirEntries {
		name := de.Name()
		if name == ".git" {
			continue
		}
		fi, err := de.Info()
		if err != nil {
			continue
		}
		kind := "file"
		var size int64 = fi.Size()
		if de.IsDir() {
			kind = "directory"
			size = 0
		}
		entryRel := name
		if normalizedRel != "." && normalizedRel != "" {
			entryRel = normalizedRel + "/" + name
		}
		entries = append(entries, Entry{
			Name:       name,
			Path:       entryRel,
			Kind:       kind,
			Size:       size,
			ModifiedAt: fi.ModTime().UTC().Format(time.RFC3339Nano),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == "directory"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	return &DirectoryListing{
		Path:    normalizedRel,
		Entries: entries,
	}, nil
}

// ReadFile reads a workspace file for the file explorer.
func ReadFile(root, relPath string) (*FileContent, error) {
	absTarget, normalizedRel, err := resolveScopedPath(root, relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absTarget)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		// The message is user-visible: the file pane shows it verbatim when a tab's path became a directory. It is
		// worded for that reader, not for a log.
		return nil, errors.New("Requested path is not a file")
	}

	raw, err := os.ReadFile(absTarget)
	if err != nil {
		return nil, err
	}

	modAt := info.ModTime().UTC().Format(time.RFC3339Nano)
	rev := fileRevision(info)
	ext := strings.ToLower(filepath.Ext(absTarget))

	if mime, ok := imageMimeByExt[ext]; ok {
		return &FileContent{
			Path:       normalizedRel,
			Kind:       "image",
			Encoding:   "base64",
			Content:    base64.StdEncoding.EncodeToString(raw),
			MimeType:   mime,
			Size:       info.Size(),
			ModifiedAt: modAt,
			Revision:   rev,
		}, nil
	}

	sample := raw
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	if bytes.IndexByte(sample, 0) != -1 || !utf8.Valid(sample) {
		return &FileContent{
			Path:       normalizedRel,
			Kind:       "binary",
			Encoding:   "none",
			MimeType:   "application/octet-stream",
			Size:       info.Size(),
			ModifiedAt: modAt,
			Revision:   rev,
		}, nil
	}

	mime := "text/plain"
	if ext == ".json" {
		mime = "application/json"
	}
	return &FileContent{
		Path:       normalizedRel,
		Kind:       "text",
		Encoding:   "utf-8",
		Content:    string(raw),
		MimeType:   mime,
		Size:       info.Size(),
		ModifiedAt: modAt,
		Revision:   rev,
	}, nil
}

// StatFileVersion returns the current FileVersion metadata for optimistic concurrency checks.
func StatFileVersion(root, relPath string) FileVersion {
	absTarget, normalizedRel, err := resolveScopedPath(root, relPath)
	if err != nil {
		return FileVersion{Status: "error", Cwd: root, Path: relPath, Error: err.Error()}
	}
	info, err := os.Stat(absTarget)
	if err != nil {
		if os.IsNotExist(err) {
			return FileVersion{Status: "missing", Cwd: root, Path: normalizedRel}
		}
		return FileVersion{Status: "error", Cwd: root, Path: normalizedRel, Error: err.Error()}
	}
	if info.IsDir() {
		// A directory where a file used to be is a state the pane has to report, not one it should paper over as
		// "ready" with a zero size.
		return FileVersion{Status: "error", Cwd: root, Path: normalizedRel, Error: "Requested path is not a file"}
	}
	return FileVersion{
		Status:     "ready",
		Cwd:        root,
		Path:       normalizedRel,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		Revision:   fileRevision(info),
	}
}

// WriteFile writes text content to a workspace file with optional optimistic concurrency checks.
func WriteFile(root, relPath, content, expectedModifiedAt, expectedRevision string) FileWriteResult {
	absTarget, normalizedRel, err := resolveScopedPath(root, relPath)
	if err != nil {
		return FileWriteResult{Status: "error", Error: err.Error()}
	}

	if info, err := os.Stat(absTarget); err == nil {
		curRev := fileRevision(info)
		curMod := info.ModTime().UTC().Format(time.RFC3339Nano)
		if expectedRevision != "" && expectedRevision != curRev {
			ver := StatFileVersion(root, normalizedRel)
			return FileWriteResult{Status: "conflict", Version: &ver}
		} else if expectedRevision == "" && expectedModifiedAt != "" && expectedModifiedAt != curMod {
			ver := StatFileVersion(root, normalizedRel)
			return FileWriteResult{Status: "conflict", Version: &ver}
		}
	}

	if err := os.WriteFile(absTarget, []byte(content), 0o644); err != nil {
		return FileWriteResult{Status: "error", Error: err.Error()}
	}
	info, err := os.Stat(absTarget)
	if err != nil {
		return FileWriteResult{Status: "error", Error: err.Error()}
	}
	return FileWriteResult{
		Status:     "written",
		ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		Size:       info.Size(),
		Revision:   fileRevision(info),
	}
}

// CreateEntry creates a new file or directory inside parentPath.
func CreateEntry(root, parentPath, name, kind string) (string, error) {
	if strings.TrimSpace(name) == "" || strings.ContainsAny(name, `/\`) {
		return "", errors.New("invalid entry name")
	}
	rel := name
	if parentPath != "" && parentPath != "." {
		rel = filepath.ToSlash(filepath.Join(parentPath, name))
	}
	absTarget, normalizedRel, err := resolveScopedPath(root, rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(absTarget); err == nil {
		return "", errors.New("entry already exists")
	}
	if kind == "directory" {
		if err := os.MkdirAll(absTarget, 0o755); err != nil {
			return "", err
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(absTarget), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(absTarget, nil, 0o644); err != nil {
			return "", err
		}
	}
	return normalizedRel, nil
}

// RenameEntry renames a file or directory within the same parent directory.
func RenameEntry(root, relPath, newName string) (string, error) {
	if strings.TrimSpace(newName) == "" || strings.ContainsAny(newName, `/\`) {
		return "", errors.New("invalid new name")
	}
	absSrc, normSrc, err := resolveScopedPath(root, relPath)
	if err != nil {
		return "", err
	}
	parentRel := filepath.ToSlash(filepath.Dir(normSrc))
	dstRel := newName
	if parentRel != "." && parentRel != "" {
		dstRel = parentRel + "/" + newName
	}
	absDst, normDst, err := resolveScopedPath(root, dstRel)
	if err != nil {
		return "", err
	}
	if err := os.Rename(absSrc, absDst); err != nil {
		return "", err
	}
	return normDst, nil
}

// DeleteEntry removes a file or directory inside the workspace.
func DeleteEntry(root, relPath string) error {
	absTarget, normRel, err := resolveScopedPath(root, relPath)
	if err != nil {
		return err
	}
	if normRel == "." || normRel == "" {
		return errors.New("cannot delete workspace root")
	}
	return os.RemoveAll(absTarget)
}

// DuplicateEntry copies a file or directory next to itself with a " copy" suffix.
//
// The name is not a detail: the app offers the duplicate under the suffixed name and the folder case has to
// recurse, so `DuplicateEntry` cannot be the single-file shortcut it used to be. Numbered suffixes exist
// because duplicating twice in a row is normal, and overwriting the first copy silently loses work.
func DuplicateEntry(root, relPath string) (string, error) {
	absSrc, normSrc, err := resolveScopedPath(root, relPath)
	if err != nil {
		return "", err
	}
	absRoot, _ := filepath.Abs(root)
	if samePath(absSrc, absRoot) {
		return "", errors.New("Cannot duplicate the workspace root")
	}
	info, err := os.Lstat(absSrc)
	if err != nil {
		return "", errors.New("File or folder no longer exists")
	}

	ext := ""
	if !info.IsDir() {
		ext = filepath.Ext(absSrc)
	}
	base := strings.TrimSuffix(filepath.Base(normSrc), ext)
	relDir := path.Dir(normSrc)
	var absDst, normDst string
	for copyNumber := 1; ; copyNumber++ {
		suffix := " copy"
		if copyNumber > 1 {
			suffix = fmt.Sprintf(" copy %d", copyNumber)
		}
		dstRel := path.Join(relDir, base+suffix+ext)
		absDst, normDst, err = resolveScopedPath(root, dstRel)
		if err != nil {
			return "", err
		}
		if _, statErr := os.Lstat(absDst); statErr != nil {
			if os.IsNotExist(statErr) {
				break
			}
			return "", statErr
		}
	}

	if err := copyEntryTree(absSrc, absDst, info); err != nil {
		return "", err
	}
	return normDst, nil
}

// copyEntryTree copies a file, symlink, or directory tree, preserving modes and timestamps.
func copyEntryTree(src, dst string, info os.FileInfo) error {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(target, dst)
	case info.IsDir():
		if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			childInfo, err := entry.Info()
			if err != nil {
				return err
			}
			if err := copyEntryTree(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name()), childInfo); err != nil {
				return err
			}
		}
		return os.Chtimes(dst, info.ModTime(), info.ModTime())
	default:
		raw, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, raw, info.Mode().Perm()); err != nil {
			return err
		}
		return os.Chtimes(dst, info.ModTime(), info.ModTime())
	}
}

// samePath reports whether two paths name the same location, resolving symlinks on both sides.
func samePath(left, right string) bool {
	leftReal, leftErr := filepath.EvalSymlinks(left)
	if leftErr != nil {
		leftReal = left
	}
	rightReal, rightErr := filepath.EvalSymlinks(right)
	if rightErr != nil {
		rightReal = right
	}
	return leftReal == rightReal
}
