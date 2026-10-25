package server

import "testing"

// Auto-archiving deletes a worktree, so every guard is load-bearing: the PR must be merged, the
// tree clean, and nothing unpushed. Each of these is work that is not in the PR.
func TestShouldAutoArchive(t *testing.T) {
	cases := []struct {
		name  string
		state autoArchiveState
		want  bool
	}{
		{
			name:  "merged, clean, pushed",
			state: autoArchiveState{PullRequestMerged: true, PullRequestURL: "https://x/pr/1"},
			want:  true,
		},
		{
			name:  "PR not merged",
			state: autoArchiveState{PullRequestMerged: false, PullRequestURL: "https://x/pr/1"},
			want:  false,
		},
		{
			name:  "uncommitted work",
			state: autoArchiveState{PullRequestMerged: true, PullRequestURL: "https://x/pr/1", IsDirty: true},
			want:  false,
		},
		{
			name:  "commits after the PR was opened",
			state: autoArchiveState{PullRequestMerged: true, PullRequestURL: "https://x/pr/1", AheadOfOrigin: 3},
			want:  false,
		},
		{
			name:  "unpushed count unknown",
			state: autoArchiveState{PullRequestMerged: true, PullRequestURL: "https://x/pr/1", AheadOfOrigin: -1},
			want:  false, // -1 means "could not tell", which must not delete
		},
	}
	for _, tc := range cases {
		if got := shouldAutoArchive(tc.state); got != tc.want {
			t.Fatalf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

// The feature is off unless the user turns it on: archiving is destructive.
func TestAutoArchiveDisabledByDefault(t *testing.T) {
	tmp := t.TempDir()
	srv, err := New(Options{HomeDir: tmp, Version: "test", PiCommand: writeFaithfulFakePi(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Close() }()
	if srv.autoArchiveEnabled() {
		t.Fatal("auto-archive must be opt-in")
	}
}
