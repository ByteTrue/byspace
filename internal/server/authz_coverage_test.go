package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/ByteTrue/byspace/internal/authz"
)

// TestEveryWSRouteIsClassified pins the invariant that the permission table covers every request
// the dispatcher accepts.
//
// An unclassified type is denied (see authz.allows), which is the safe default but appears as a
// feature mysteriously refusing to run. This test turns that into a build failure with a list,
// so adding a route without classifying it cannot reach a user.
func TestEveryWSRouteIsClassified(t *testing.T) {
	routed := wsRouteTypes(t)
	missing := make([]string, 0, 8)
	for _, messageType := range routed {
		if _, ok := authz.InboundPermission[messageType]; ok {
			continue
		}
		if authz.InboundUnrestricted[messageType] {
			continue
		}
		missing = append(missing, messageType)
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("these dispatchable request types have no permission requirement "+
			"and would be denied for everyone; add them to\n"+
			"archive/packages/server/src/server/authorization/operation-permissions.ts and regenerate:\n  %s",
			strings.Join(missing, "\n  "))
	}
}

// wsRouteTypes extracts the message types the dispatcher accepts.
func wsRouteTypes(t *testing.T) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "server.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}

	stringCase := regexp.MustCompile(`^"[a-z][a-z0-9_.\-/]*"$`)
	var out []string

	ast.Inspect(file, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "handleSessionMessage" {
			return true
		}
		ast.Inspect(fn.Body, func(inner ast.Node) bool {
			clause, ok := inner.(*ast.CaseClause)
			if !ok {
				return true
			}
			for _, expr := range clause.List {
				lit, ok := expr.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING || !stringCase.MatchString(lit.Value) {
					continue
				}
				if value, unquoteErr := strconv.Unquote(lit.Value); unquoteErr == nil {
					out = append(out, value)
				}
			}
			return true
		})
		return true
	})
	return out
}
