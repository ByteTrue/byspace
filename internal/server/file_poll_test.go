package server

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/coder/websocket"
	"time"
)

// Reading a file to compute its revision once a second is affordable for a source file and
// ruinous for a 10 MB log; the stamp is a stat, and only a change in it is worth a read.
func TestFileSubscriptionUsesStampToSkipReads(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: filepath.Join(tmp, "home"), Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Close() }()

	file := filepath.Join(tmp, "watched.txt")
	if err := os.WriteFile(file, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}

	sink := &recordingSink{}
	srv.mu.Lock()
	srv.clients[sink] = true
	srv.fileSubs["sub1"] = fileSubscription{
		id: "sub1", sink: sink, cwd: tmp, path: "watched.txt",
	}
	srv.mu.Unlock()

	// First poll records the stamp; the version starts empty so this one pushes.
	srv.PollSubscriptionsOnce(context.Background())
	srv.mu.Lock()
	afterFirst := srv.fileSubs["sub1"]
	srv.mu.Unlock()
	if afterFirst.stamp == "" {
		t.Fatal("the stamp was not recorded")
	}
	firstCount := sink.count()

	// No change: no push and the stamp is unchanged.
	srv.PollSubscriptionsOnce(context.Background())
	if sink.count() != firstCount {
		t.Fatal("an unchanged file must not push")
	}

	// A real change pushes, and the stamp moves.
	if err := os.WriteFile(file, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Force a distinct mtime: filesystems with coarse timestamps could otherwise hide it.
	future := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(file, future, future)

	srv.PollSubscriptionsOnce(context.Background())
	if sink.count() <= firstCount {
		t.Fatal("a changed file must push")
	}
	srv.mu.Lock()
	afterChange := srv.fileSubs["sub1"]
	srv.mu.Unlock()
	if afterChange.stamp == afterFirst.stamp {
		t.Fatal("the stamp should have moved")
	}
}

// recordingSink counts the messages a subscription pushed.
type recordingSink struct {
	mu    sync.Mutex
	texts []string
}

func (r *recordingSink) SendText(_ context.Context, text string) error {
	r.mu.Lock()
	r.texts = append(r.texts, text)
	r.mu.Unlock()
	return nil
}

func (r *recordingSink) SendBinary(_ context.Context, _ []byte) error { return nil }

func (r *recordingSink) Close(websocket.StatusCode, string) error { return nil }

func (r *recordingSink) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.texts)
}
