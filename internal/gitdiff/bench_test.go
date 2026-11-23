package gitdiff

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/workspace"
)

const largeRepoFiles = 1000

// largeRepo builds a checkout with largeRepoFiles committed files and returns it.
func largeRepo(b *testing.B) string {
	b.Helper()
	dir := b.TempDir()
	mustGit := func(args ...string) {
		if _, err := workspace.Git(context.Background(), dir, args...); err != nil {
			b.Fatalf("git %v: %v", args, err)
		}
	}
	mustGit("init", "-b", "main")
	mustGit("config", "user.email", "bench@example.com")
	mustGit("config", "user.name", "Bench")
	for i := 0; i < largeRepoFiles; i++ {
		writeLargeRepoFile(b, dir, i, 1)
	}
	mustGit("add", ".")
	mustGit("commit", "-m", "seed")
	return dir
}

func writeLargeRepoFile(b *testing.B, dir string, index, lines int) {
	b.Helper()
	name := filepath.Join(dir, "file"+fmt.Sprintf("%04d", index)+".txt")
	var body []byte
	for line := 0; line < lines; line++ {
		body = append(body, []byte(fmt.Sprintf("line %d of file %d\n", line, index))...)
	}
	if err := os.WriteFile(name, body, 0o644); err != nil {
		b.Fatal(err)
	}
}

func resultBytes(files []workspace.ParsedDiffFile) int {
	total := 0
	for _, file := range files {
		total += bodyBytes(file)
	}
	return total
}

// BenchmarkEngineOneFileEdit is the slice-2 cost of one edit in a 1000-file checkout: the engine
// rereads the file that moved and sends only that file.
func BenchmarkEngineOneFileEdit(b *testing.B) {
	dir := largeRepo(b)
	engine := New()
	defer engine.Close()
	// The 150 ms window is the product's coalescing decision, not the cost being measured here.
	engine.coalesce = time.Millisecond

	delivered := make(chan Result, 1)
	sub := engine.Subscribe(Key{Cwd: dir}, func(result Result) { delivered <- result })
	defer sub.Unsubscribe()
	<-delivered

	bytes := 0
	for i := 0; i < b.N; i++ {
		writeLargeRepoFile(b, dir, i%largeRepoFiles, 2)
		engine.Invalidate(Key{Cwd: dir})
		select {
		case result := <-delivered:
			bytes += resultBytes(result.Files)
		case <-time.After(30 * time.Second):
			b.Fatal("no delivery after an edit")
		}
	}
	b.ReportMetric(float64(bytes)/float64(b.N), "body-bytes/update")
}

// BenchmarkFullWorkingDiff is the old path's cost per poll: a full `git diff HEAD` parsed into
// every file, which the 1 s poller paid per pane per second regardless of what changed.
func BenchmarkFullWorkingDiff(b *testing.B) {
	dir := largeRepo(b)
	bytes := 0
	for i := 0; i < b.N; i++ {
		writeLargeRepoFile(b, dir, i%largeRepoFiles, 2)
		files, err := workspace.GetWorkingDiff(context.Background(), dir, false)
		if err != nil {
			b.Fatal(err)
		}
		bytes += resultBytes(files)
	}
	b.ReportMetric(float64(bytes)/float64(b.N), "body-bytes/update")
}
