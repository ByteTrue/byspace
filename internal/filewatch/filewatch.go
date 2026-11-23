// Package filewatch reports changes under a directory tree.
//
// One Observation owns the platform watchers; a Subscription is one root handed to it. Linux,
// macOS and Windows backends share the exclusion, cap, and release rules here so a consumer never
// branches on the platform.
package filewatch

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Kind is what happened to a path.
type Kind int

const (
	// Created means the path did not exist before this event.
	Created Kind = iota
	// Written means an existing path's content or metadata changed.
	Written
	// Renamed means the path moved; Event.From names where it was.
	Renamed
	// Removed means the path no longer exists.
	Removed
)

func (k Kind) String() string {
	switch k {
	case Created:
		return "created"
	case Written:
		return "written"
	case Renamed:
		return "renamed"
	case Removed:
		return "removed"
	default:
		return "unknown"
	}
}

// Event is one observed change. Path is absolute.
type Event struct {
	Path string
	// From is the previous absolute path of a Renamed event.
	From string
	Kind Kind
}

// Options configures a subscription.
type Options struct {
	// Excluded lists absolute directory roots that are not observed.
	Excluded []string
}

// Subscription is one observed root.
type Subscription interface {
	// UpdateExclusions replaces the excluded roots. Once it returns, no event below a newly
	// excluded root is delivered.
	UpdateExclusions(roots []string) error
	// Degraded is closed when the backend stopped reporting reliably. The owner must poll until
	// the subscription is re-established; see polling.go.
	Degraded() <-chan struct{}
	// Release stops observation. It is a barrier: once it returns, no handler runs and no
	// platform handle for this subscription remains, even if the root was renamed or deleted.
	Release()
}

// Diagnostics is the aggregate health of one Observation.
type Diagnostics struct {
	Subscriptions int
	// Tracked is the number of paths the backends are watching (directories plus, where the
	// platform reports per-file events, tracked files).
	Tracked int
	// Pending is queued work not yet delivered.
	Pending int
	// Degraded counts subscriptions that fell back to polling after a watch failure.
	Degraded int
	// Failures counts watch errors since the observation was created.
	Failures int64
}

// Observation observes directory trees and reports changes to their subscribers.
type Observation interface {
	Subscribe(root string, opts Options, handler func(Event)) (Subscription, error)
	Diagnostics() Diagnostics
	// Close releases every subscription.
	Close() error
}

// exclusionUpdate carries a new exclusion set to the backend goroutine, which closes done once the
// set is applied. That acknowledgement is what makes UpdateExclusions a delivery barrier.
type exclusionUpdate struct {
	roots []string
	done  chan struct{}
}

// cleanRoot validates a subscription root and returns it without a trailing separator.
func cleanRoot(root string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("filewatch: empty root")
	}
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("filewatch: root %q is not absolute", root)
	}
	return filepath.Clean(root), nil
}

// under reports whether path is root or inside it.
func under(root, path string) bool {
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}

// excluded reports whether path is covered by one of the excluded roots.
func excluded(roots []string, path string) bool {
	for _, root := range roots {
		if root != "" && under(filepath.Clean(root), path) {
			return true
		}
	}
	return false
}

// cleanExclusions validates and normalizes excluded roots.
func cleanExclusions(roots []string) ([]string, error) {
	if len(roots) == 0 {
		return nil, nil
	}
	cleaned := make([]string, 0, len(roots))
	for _, root := range roots {
		root = filepath.Clean(root)
		if !filepath.IsAbs(root) {
			return nil, fmt.Errorf("filewatch: excluded root %q is not absolute", root)
		}
		cleaned = append(cleaned, root)
	}
	return cleaned, nil
}
