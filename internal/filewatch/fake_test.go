package filewatch

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestFakeDeliversChangesInOrder(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a.txt")
	b := filepath.Join(root, "b.txt")
	nested := filepath.Join(root, "dir", "c.txt")

	f := NewFake()
	var got []Event
	sub, err := f.Subscribe(root, Options{}, func(ev Event) { got = append(got, ev) })
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Release()

	steps := []struct {
		name string
		emit func()
		want Event
	}{
		{"create", func() { f.Create(a) }, Event{Path: a, Kind: Created}},
		{"write", func() { f.Write(a) }, Event{Path: a, Kind: Written}},
		{"rename", func() { f.Rename(a, b) }, Event{Path: b, From: a, Kind: Renamed}},
		{"nested create", func() { f.Create(nested) }, Event{Path: nested, Kind: Created}},
		{"remove", func() { f.Remove(b) }, Event{Path: b, Kind: Removed}},
	}
	for _, step := range steps {
		step.emit()
		if len(got) != 1 || got[0] != step.want {
			t.Fatalf("after %s: events = %#v, want [%#v]", step.name, got, step.want)
		}
		got = nil
	}
}

func TestFakeHonorsExclusionsAndRelease(t *testing.T) {
	root := t.TempDir()
	ignored := filepath.Join(root, "node_modules")
	src := filepath.Join(root, "src")
	kept := filepath.Join(src, "main.go")

	f := NewFake()
	var got []Event
	sub, err := f.Subscribe(root, Options{Excluded: []string{ignored}}, func(ev Event) {
		got = append(got, ev)
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	f.Create(filepath.Join(ignored, "dep.js"))
	f.Create(kept)
	if err := sub.UpdateExclusions([]string{src}); err != nil {
		t.Fatalf("update exclusions: %v", err)
	}
	f.Create(filepath.Join(src, "other.go"))
	sub.Release()
	f.Create(filepath.Join(root, "after.go"))

	want := []Event{{Path: kept, Kind: Created}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %#v, want %#v", got, want)
	}
}

func TestSubscribeRejectsRelativeRoot(t *testing.T) {
	f := NewFake()
	if _, err := f.Subscribe("relative/dir", Options{}, func(Event) {}); err == nil {
		t.Fatal("expected an error for a relative root")
	}
}
