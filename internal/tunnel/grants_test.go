package tunnel

import "testing"

func TestGrantsAllowAndRecall(t *testing.T) {
	dir := t.TempDir()
	grants, err := LoadGrants(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := grants.Allow("pk_a", 3425); err != nil {
		t.Fatal(err)
	}
	if err := grants.Allow("pk_a", 3425); err != nil {
		t.Fatal(err)
	}

	reloaded, err := LoadGrants(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.Allowed("pk_a", 3425) {
		t.Fatal("a granted key was refused after reload")
	}
	if reloaded.Allowed("pk_a", 22) || reloaded.Allowed("pk_b", 3425) {
		t.Fatal("a grant matched a different key or port")
	}
	if len(reloaded.List()) != 1 {
		t.Fatalf("allowing the same pair twice stored %d grants", len(reloaded.List()))
	}
}

func TestGrantsMissingFileIsEmpty(t *testing.T) {
	grants, err := LoadGrants(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if grants.Allowed("pk_a", 1) {
		t.Fatal("an empty allow list granted access")
	}
}
