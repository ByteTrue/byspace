package server

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ByteTrue/byspace/internal/proc"
)

// gitRefProbeTimeout bounds the one git call a probe makes.
const gitRefProbeTimeout = 5 * time.Second

// gitRefProbe remembers the object id each ref pointed at and re-reads a batch in one git call.
//
// The object id is the only signal that something the UI shows changed: git rewrites a ref file
// for a lock dance, a pack, or a fetch that found nothing, and a rewrite naming the same object is
// not a change. Probing also catches a push that moves refs/remotes/origin/<branch> while HEAD
// stays put, which the HEAD fingerprint could not see.
type gitRefProbe struct {
	mu   sync.Mutex
	seen map[string]map[string]string
}

func newGitRefProbe() *gitRefProbe {
	return &gitRefProbe{seen: map[string]map[string]string{}}
}

// probe re-reads refs and reports the ones whose object id moved.
//
// The first reading of a ref counts as a move: the server has no earlier answer for it, so
// treating it as unchanged would leave the checkout stale until the next write. all widens the
// call to every ref already seen for the checkout, which is what files that name no ref
// (packed-refs, config, HEAD) need.
func (p *gitRefProbe) probe(ctx context.Context, cwd string, refs []string, all bool) ([]string, error) {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return nil, fmt.Errorf("server: no checkout to probe")
	}
	p.mu.Lock()
	known := p.seen[cwd]
	names := map[string]struct{}{"HEAD": {}}
	for _, ref := range refs {
		if ref = strings.TrimSpace(ref); ref != "" {
			names[ref] = struct{}{}
		}
	}
	if all {
		for ref := range known {
			names[ref] = struct{}{}
		}
	}
	p.mu.Unlock()

	ordered := make([]string, 0, len(names))
	for ref := range names {
		ordered = append(ordered, ref)
	}
	sort.Strings(ordered)

	ctx, cancel := context.WithTimeout(ctx, gitRefProbeTimeout)
	defer cancel()
	cmd := proc.CommandContext(ctx, "git", "-C", cwd, "cat-file", "--batch-check=%(objectname)")
	cmd.Stdin = strings.NewReader(strings.Join(ordered, "\n") + "\n")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\n"), "\n")
	if len(lines) != len(ordered) {
		return nil, fmt.Errorf("server: ref probe answered %d of %d refs", len(lines), len(ordered))
	}

	next := make(map[string]string, len(known)+len(ordered))
	for ref, sha := range known {
		next[ref] = sha
	}
	var moved []string
	for index, ref := range ordered {
		fields := strings.Fields(lines[index])
		// A resolved ref answers with its object id alone. A missing or ambiguous one answers
		// "<ref> missing", so any extra field means there is no id to compare.
		if len(fields) != 1 {
			if _, existed := known[ref]; existed {
				moved = append(moved, ref)
				delete(next, ref)
			}
			continue
		}
		if previous, existed := known[ref]; !existed || previous != fields[0] {
			moved = append(moved, ref)
		}
		next[ref] = fields[0]
	}

	p.mu.Lock()
	p.seen[cwd] = next
	p.mu.Unlock()
	return moved, nil
}
