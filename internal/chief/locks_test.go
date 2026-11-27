package chief

import (
	"errors"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestClaimSharedLocksNormalizesPersistsAndReleases(t *testing.T) {
	st := NewStore(t.TempDir())
	_, err := st.CreateMission(Mission{
		ID:     "msn_locks",
		Tier:   TierL2,
		Status: MissionStatusActive,
		Threads: []Thread{
			{ID: "thr_a", MissionID: "msn_locks", OwnedPaths: []string{"go.mod", "pkg/", "docs/**", "cmd/*", "win/**"}},
			{ID: "thr_b", MissionID: "msn_locks", OwnedPaths: []string{"other/**"}},
		},
	})
	if err != nil {
		t.Fatalf("CreateMission: %v", err)
	}

	_, err = st.UpdateMission("msn_locks", func(m *Mission) error {
		return ClaimSharedLocks(m, "thr_a", []string{
			"go.mod",
			"./go.mod",
			"pkg//b.go",
			`pkg\a.go`,
			"docs/guide/readme.md",
			"cmd/tool.go",
			`win\dir\file.go`,
		})
	})
	if err != nil {
		t.Fatalf("ClaimSharedLocks: %v", err)
	}

	m, err := st.GetMission("msn_locks")
	if err != nil {
		t.Fatalf("GetMission: %v", err)
	}
	got := make([]string, 0, len(m.SharedLocks))
	for p, owner := range m.SharedLocks {
		if owner != "thr_a" {
			t.Fatalf("lock %q owner = %q, want thr_a", p, owner)
		}
		got = append(got, p)
	}
	sort.Strings(got)
	want := []string{"cmd/tool.go", "docs/guide/readme.md", "go.mod", "pkg/a.go", "pkg/b.go", "win/dir/file.go"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("locked paths = %#v, want %#v", got, want)
	}

	if err := ClaimSharedLocks(m, "thr_a", []string{"go.mod", "./go.mod"}); err != nil {
		t.Fatalf("same-owner claim must be idempotent: %v", err)
	}
	ReleaseSharedLocks(m, "thr_b")
	if len(m.SharedLocks) != len(want) {
		t.Fatalf("release for another thread changed locks: %#v", m.SharedLocks)
	}
	m.SharedLocks["other/file.go"] = "thr_b"
	ReleaseSharedLocks(m, "thr_a")
	if !reflect.DeepEqual(m.SharedLocks, map[string]string{"other/file.go": "thr_b"}) {
		t.Fatalf("release did not isolate ownership: %#v", m.SharedLocks)
	}
}

func TestClaimSharedLocksRejectsWithoutPartialState(t *testing.T) {
	base := Mission{
		Tier: TierL2,
		SharedLocks: map[string]string{
			"pkg/held.go":       "thr_b",
			"other/existing.go": "thr_b",
		},
		Threads: []Thread{
			{ID: "thr_a", OwnedPaths: []string{"go.mod", "pkg/**"}},
			{ID: "thr_b", OwnedPaths: []string{"other/**"}},
		},
	}
	tests := []struct {
		name  string
		paths []string
	}{
		{name: "no paths"},
		{name: "empty path", paths: []string{""}},
		{name: "blank path", paths: []string{"  "}},
		{name: "dot", paths: []string{"."}},
		{name: "directory path", paths: []string{"go.mod/"}},
		{name: "windows directory path", paths: []string{`go.mod\`}},
		{name: "slash absolute", paths: []string{"/go.mod"}},
		{name: "windows absolute", paths: []string{`C:\go.mod`}},
		{name: "unc absolute", paths: []string{`\\server\share\go.mod`}},
		{name: "parent escape", paths: []string{"../go.mod"}},
		{name: "windows parent escape", paths: []string{`pkg\..\..\go.mod`}},
		{name: "not concrete", paths: []string{"pkg/*.go"}},
		{name: "not owned", paths: []string{"unowned.go"}},
		{name: "held by another thread", paths: []string{"go.mod", "pkg/held.go"}},
		{name: "owned by another thread", paths: []string{"go.mod", "other/new.go"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := cloneMission(base)
			before := cloneMission(m).SharedLocks
			err := ClaimSharedLocks(&m, "thr_a", tt.paths)
			if !errors.Is(err, ErrOwnedPathViolation) {
				t.Fatalf("error = %v, want ErrOwnedPathViolation", err)
			}
			var ownershipErr *OwnershipError
			if !errors.As(err, &ownershipErr) {
				t.Fatalf("error type = %T, want OwnershipError", err)
			}
			if !reflect.DeepEqual(m.SharedLocks, before) {
				t.Fatalf("locks mutated on rejection: got %#v, want %#v", m.SharedLocks, before)
			}
			if tt.name == "blank path" && (strings.Contains(err.Error(), "changed path is empty") || !strings.Contains(err.Error(), "not owned")) {
				t.Fatalf("blank but concrete path must fail ownership, not whitespace validation: %v", err)
			}
		})
	}
}

func TestClaimSharedLocksPreservesWhitespaceDistinctPaths(t *testing.T) {
	m := Mission{Tier: TierL2, Threads: []Thread{{ID: "thr_a", OwnedPaths: []string{"plain.txt", " plain.txt "}}}}
	if err := ClaimSharedLocks(&m, "thr_a", []string{"plain.txt", " plain.txt "}); err != nil {
		t.Fatalf("ClaimSharedLocks: %v", err)
	}
	want := map[string]string{"plain.txt": "thr_a", " plain.txt ": "thr_a"}
	if !reflect.DeepEqual(m.SharedLocks, want) {
		t.Errorf("whitespace-distinct locks collapsed: got %#v, want %#v", m.SharedLocks, want)
	}
	if IsPathOwned("plain.txt", []string{" plain.txt "}, nil, "thr_a") {
		t.Error("whitespace-distinct owned pattern matched plain.txt")
	}
	if !IsPathOwned(" plain.txt ", []string{" plain.txt "}, nil, "thr_a") {
		t.Error("exact whitespace-containing owned pattern did not match")
	}
}

func TestClaimSharedLocksEmptyL2OwnershipFailsClosed(t *testing.T) {
	m := Mission{Tier: TierL2, Threads: []Thread{{ID: "thr_a"}}}
	if err := ClaimSharedLocks(&m, "thr_a", []string{"any.go"}); !errors.Is(err, ErrOwnedPathViolation) {
		t.Fatalf("error = %v, want ErrOwnedPathViolation", err)
	}
	if len(m.SharedLocks) != 0 {
		t.Fatalf("locks mutated: %#v", m.SharedLocks)
	}
}

func TestClaimSharedLocksIgnoresTerminalThreadOwnership(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  string
		wantErr bool
	}{
		{name: "landed", status: ThreadStatusLanded},
		{name: "canceled", status: ThreadStatusCanceled},
		{name: "failed", status: ThreadStatusFailed},
		{name: "active control", status: ThreadStatusAuthoring, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := Mission{Tier: TierL2, Threads: []Thread{
				{ID: "thr_a", Status: ThreadStatusAuthoring, OwnedPaths: []string{"pkg/**"}},
				{ID: "thr_b", Status: tc.status, OwnedPaths: []string{"pkg/**"}},
			}}
			err := ClaimSharedLocks(&m, "thr_a", []string{"pkg/new.go"})
			if tc.wantErr && !errors.Is(err, ErrOwnedPathViolation) {
				t.Fatalf("error = %v, want active ownership conflict", err)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("terminal ownership blocked claim: %v", err)
			}
			if tc.wantErr && len(m.SharedLocks) != 0 {
				t.Fatalf("active conflict mutated locks: %#v", m.SharedLocks)
			}
			if !tc.wantErr && !reflect.DeepEqual(m.SharedLocks, map[string]string{"pkg/new.go": "thr_a"}) {
				t.Fatalf("locks = %#v", m.SharedLocks)
			}
			if !reflect.DeepEqual(m.Threads[1].OwnedPaths, []string{"pkg/**"}) {
				t.Fatalf("terminal ownership metadata changed: %#v", m.Threads[1].OwnedPaths)
			}
		})
	}
}
