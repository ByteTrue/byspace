package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Methods that take s.mu themselves. Calling one while s.mu is already held deadlocks the
// caller — Go's mutex is not re-entrant — and the failure mode is a silent stall of the provider
// event loop, not an error.
//
// This exact bug shipped twice: handleEntryCaptureNotification and handleCommandResultNotification
// (notes/013), then attentionIsFocused. A comment was not enough, so it is checked mechanically.
var selfLockingMethods = map[string]bool{
	"attentionIsFocused":   true,
	"markAgentAttention":   true,
	"clearAgentAttention":  true,
	"canMarkUnread":        true,
	"firstMarkableAgent":   true,
	"broadcastAgentUpdate": true,
	"broadcastSessionMsg":  true,
	// broadcastDirectoryUpdate locks to classify its sinks by cursor capability.
	"broadcastDirectoryUpdate": true,
	// appendSystemErrorRow broadcasts, so it self-locks through broadcastSessionMsg.
	"appendSystemErrorRow":          true,
	"buildAgentSnapshotPayload":     true,
	"applyRelayConfig":              true,
	"ApplyRelayConfig":              true,
	"releaseTerminalSubscriptions":  true,
	"registerTerminalSubscription":  true,
	"servicePeers":                  true,
	"projectForWorkspace":           true,
	"refreshWorkspaceStatusBuckets": true,
	"publishWorkspaceStatusChanges": true,
	"broadcastWorkspaceUpsert":      true,
	"workspaceStatus":               true,
}

// TestNoReentrantServerLocks parses every non-test file in this package and reports a call to a
// self-locking method that appears lexically between `s.mu.Lock()` and `s.mu.Unlock()`.
//
// Lexical rather than flow-sensitive: it cannot see a lock released in another branch, so the
// rule is the conservative one — do not call these inside the locked region at all.
func TestNoReentrantServerLocks(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}

	fset := token.NewFileSet()
	var violations []string

	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		file, parseErr := parser.ParseFile(fset, path, src, 0)
		if parseErr != nil {
			t.Fatalf("%s: %v", path, parseErr)
		}

		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				return true
			}
			locked := 0
			ast.Inspect(fn.Body, func(inner ast.Node) bool {
				switch node := inner.(type) {
				case *ast.CallExpr:
					sel, ok := node.Fun.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					// s.mu.Lock() / s.mu.Unlock()
					if sel.Sel.Name == "Lock" || sel.Sel.Name == "Unlock" || sel.Sel.Name == "RLock" || sel.Sel.Name == "RUnlock" {
						if isServerMutex(sel) {
							if sel.Sel.Name == "Lock" || sel.Sel.Name == "RLock" {
								locked++
							} else if locked > 0 {
								locked--
							}
							return true
						}
					}
					if locked > 0 && selfLockingMethods[sel.Sel.Name] {
						pos := fset.Position(node.Pos())
						violations = append(violations, pos.String()+" "+fn.Name.Name+" calls "+sel.Sel.Name)
					}
				}
				return true
			})
			return true
		})
	}

	if len(violations) > 0 {
		t.Fatalf("calls to self-locking methods inside a locked region (deadlock):\n  %s",
			strings.Join(violations, "\n  "))
	}
}

// isServerMutex reports whether the call is `s.mu.Lock` — the receiver is `s.mu`, itself a
// selector whose X is the server variable.
func isServerMutex(sel *ast.SelectorExpr) bool {
	mu, ok := sel.X.(*ast.SelectorExpr)
	if !ok || mu.Sel.Name != "mu" {
		return false
	}
	id, ok := mu.X.(*ast.Ident)
	if !ok {
		return false
	}
	return id.Name == "s" || id.Name == "server"
}
