package store

import "testing"

// The catalog file doubles as the older bare-array labels file, so every writer has to keep the
// catalog shape. Writing an array there made the next read see no labels at all, and the rewrite
// that followed dropped everything the array had not carried.
func TestSetWorkspaceLabelAssignmentKeepsEveryLabel(t *testing.T) {
	st := New(t.TempDir())
	if _, _, err := st.CreateWorkspaceForDirectory(t.TempDir(), "ws_1", ""); err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	if _, err := st.SetWorkspaceLabelAssignment("ws_1", LabelDefinition{Name: "Urgent", Color: "red"}, true); err != nil {
		t.Fatalf("assign urgent: %v", err)
	}
	// The assignment RPC is followed by the catalog push in the same handler, and that push is what
	// turns the file into a catalog. Without it this test would only ever exercise the array shape.
	st.MutateLabelCatalog(func(c *LabelCatalog) (map[string]any, bool) {
		return map[string]any{"kind": "upsert"}, true
	})
	if _, err := st.SetWorkspaceLabelAssignment("ws_1", LabelDefinition{Name: "Frontend", Color: "sky"}, true); err != nil {
		t.Fatalf("assign frontend: %v", err)
	}

	catalog := st.LoadLabelCatalog()
	names := map[string]string{}
	for _, label := range catalog.Labels {
		names[label.Name] = label.Color
	}
	if names["Urgent"] != "red" {
		t.Fatalf("expected Urgent to survive, got %v", catalog.Labels)
	}
	if names["Frontend"] != "sky" {
		t.Fatalf("expected Frontend in the catalog, got %v", catalog.Labels)
	}
}

func TestUpdateLabelKeepsTheOtherLabels(t *testing.T) {
	st := New(t.TempDir())
	if _, _, err := st.CreateWorkspaceForDirectory(t.TempDir(), "ws_1", ""); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := st.SetWorkspaceLabelAssignment("ws_1", LabelDefinition{Name: "Urgent", Color: "red"}, true); err != nil {
		t.Fatalf("assign urgent: %v", err)
	}
	if _, err := st.SetWorkspaceLabelAssignment("ws_1", LabelDefinition{Name: "Frontend", Color: "sky"}, true); err != nil {
		t.Fatalf("assign frontend: %v", err)
	}

	if _, _, err := st.UpdateLabel("Urgent", "Blocked", "amber"); err != nil {
		t.Fatalf("update label: %v", err)
	}

	catalog := st.LoadLabelCatalog()
	names := map[string]string{}
	for _, label := range catalog.Labels {
		names[label.Name] = label.Color
	}
	if names["Blocked"] != "amber" {
		t.Fatalf("expected the rename to land, got %v", catalog.Labels)
	}
	if names["Frontend"] != "sky" {
		t.Fatalf("expected Frontend to survive the rename, got %v", catalog.Labels)
	}
}

func TestLabelCatalogGenerationSurvivesAnAssignment(t *testing.T) {
	st := New(t.TempDir())
	if _, _, err := st.CreateWorkspaceForDirectory(t.TempDir(), "ws_1", ""); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	before := st.LoadLabelCatalog()
	if _, err := st.SetWorkspaceLabelAssignment("ws_1", LabelDefinition{Name: "Urgent", Color: "red"}, true); err != nil {
		t.Fatalf("assign urgent: %v", err)
	}
	after := st.LoadLabelCatalog()
	if after.Generation != before.Generation {
		t.Fatalf("assignment changed the generation: %q -> %q", before.Generation, after.Generation)
	}
	// A replica applies an update only when its seq is exactly one past the cursor, so an
	// assignment that moved headSeq without a matching frame would desync every client.
	if after.HeadSeq != before.HeadSeq {
		t.Fatalf("assignment moved headSeq without a frame: %d -> %d", before.HeadSeq, after.HeadSeq)
	}
}
