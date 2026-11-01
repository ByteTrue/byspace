package store

import (
	"errors"
	"fmt"
	"slices"
	"testing"
)

// These follow Node's WorkspaceLabelService: a label is identified by its key (case and spacing
// folded), the request's mistakes are refused with a code, and every call reports what it changed
// so the server can publish exactly that.

func newLabelStore(t *testing.T, n int) (*Store, []string) {
	t.Helper()
	st := New(t.TempDir())
	ids := make([]string, 0, n)
	for i := range n {
		_, workspace, err := st.CreateWorkspaceForDirectory(t.TempDir(), fmt.Sprintf("ws %d", i), "")
		if err != nil {
			t.Fatalf("create workspace: %v", err)
		}
		ids = append(ids, workspace.WorkspaceID)
	}
	return st, ids
}

func labelErrorCode(err error) string {
	var labelErr *LabelError
	if errors.As(err, &labelErr) {
		return labelErr.Code
	}
	return ""
}

func labelsOf(t *testing.T, st *Store, workspaceID string) []string {
	t.Helper()
	workspaces, err := readJSONArray[WorkspaceRecord](st.workspacesPath())
	if err != nil {
		t.Fatalf("read workspaces: %v", err)
	}
	for _, w := range workspaces {
		if w.WorkspaceID == workspaceID {
			return w.Labels
		}
	}
	t.Fatalf("workspace %s not found", workspaceID)
	return nil
}

func catalogNames(st *Store) map[string]string {
	names := map[string]string{}
	for _, label := range st.LoadLabelCatalog().Labels {
		names[label.Name] = label.Color
	}
	return names
}

func assign(t *testing.T, st *Store, workspaceID, name, color string, assigned bool) LabelAssignmentResult {
	t.Helper()
	result, err := st.SetWorkspaceLabelAssignment(workspaceID, LabelDefinition{Name: name, Color: color}, assigned)
	if err != nil {
		t.Fatalf("assign %q: %v", name, err)
	}
	return result
}

func TestAssignmentMatchesALabelByKeyAndKeepsItsCatalogEntry(t *testing.T) {
	st, ids := newLabelStore(t, 2)
	first := assign(t, st, ids[0], "  Urgent ", "red", true)
	if !first.CatalogChanged || first.Label.Name != "Urgent" || first.Workspace == nil {
		t.Fatalf("first assignment should create Urgent and rewrite the workspace: %+v", first)
	}
	// Same label spelled differently, with another colour: it is the existing label, unchanged.
	second := assign(t, st, ids[1], "urgent", "sky", true)
	if second.CatalogChanged || second.Label != (LabelDefinition{Name: "Urgent", Color: "red"}) {
		t.Fatalf("second assignment should reuse Urgent as it is: %+v", second)
	}
	if got := labelsOf(t, st, ids[1]); !slices.Equal(got, []string{"Urgent"}) {
		t.Fatalf("workspace should carry the catalog's name, got %v", got)
	}
	again := assign(t, st, ids[1], "URGENT", "red", true)
	if again.Workspace != nil || again.CatalogChanged {
		t.Fatalf("assigning a label the workspace has changes nothing: %+v", again)
	}
	if names := catalogNames(st); len(names) != 1 || names["Urgent"] != "red" {
		t.Fatalf("catalog should hold one red Urgent, got %v", names)
	}
}

func TestUnassigningAnUnknownLabelCreatesNothing(t *testing.T) {
	st, ids := newLabelStore(t, 1)
	result := assign(t, st, ids[0], "Ghost", "red", false)
	if result.CatalogChanged || result.Workspace != nil {
		t.Fatalf("unassigning an unknown label changed something: %+v", result)
	}
	if names := catalogNames(st); len(names) != 0 {
		t.Fatalf("unassign created a catalog entry: %v", names)
	}
}

func TestAssignmentRefusesAMissingWorkspaceAndAnEmptyName(t *testing.T) {
	st, ids := newLabelStore(t, 1)
	if _, err := st.SetWorkspaceLabelAssignment("wks_missing", LabelDefinition{Name: "Urgent", Color: "red"}, true); labelErrorCode(err) != "workspace_not_found" {
		t.Fatalf("expected workspace_not_found, got %v", err)
	}
	if _, err := st.SetWorkspaceLabelAssignment(ids[0], LabelDefinition{Name: "   ", Color: "red"}, true); labelErrorCode(err) != "label_name_empty" {
		t.Fatalf("expected label_name_empty, got %v", err)
	}
	if names := catalogNames(st); len(names) != 0 {
		t.Fatalf("a refused assignment wrote the catalog: %v", names)
	}
}

func TestRenameRewritesEveryAssignmentAndReportsTheWorkspaces(t *testing.T) {
	st, ids := newLabelStore(t, 3)
	assign(t, st, ids[0], "Urgent", "red", true)
	assign(t, st, ids[1], "Urgent", "red", true)
	assign(t, st, ids[1], "Frontend", "sky", true)
	before := labelsOf(t, st, ids[2])

	blocked := "Blocked"
	result, err := st.UpdateLabel("urgent", &blocked, nil)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if !result.Changed || result.PreviousName != "Urgent" || result.Label != (LabelDefinition{Name: "Blocked", Color: "red"}) {
		t.Fatalf("unexpected rename result: %+v", result)
	}
	var rewritten []string
	for _, w := range result.Workspaces {
		rewritten = append(rewritten, w.WorkspaceID)
	}
	slices.Sort(rewritten)
	want := []string{ids[0], ids[1]}
	slices.Sort(want)
	if !slices.Equal(rewritten, want) {
		t.Fatalf("rename should report the two labelled workspaces, got %v", rewritten)
	}
	if got := labelsOf(t, st, ids[1]); !slices.Equal(got, []string{"Blocked", "Frontend"}) {
		t.Fatalf("assignment not renamed in place: %v", got)
	}
	if got := labelsOf(t, st, ids[2]); !slices.Equal(got, before) {
		t.Fatalf("an unlabelled workspace changed: %v", got)
	}
	if names := catalogNames(st); names["Blocked"] != "red" || len(names) != 2 {
		t.Fatalf("catalog after rename: %v", names)
	}
}

func TestRenameOntoAnotherLabelIsRefusedButACaseEditPasses(t *testing.T) {
	st, ids := newLabelStore(t, 1)
	assign(t, st, ids[0], "Urgent", "red", true)
	assign(t, st, ids[0], "Frontend", "sky", true)

	taken := "frontend"
	if _, err := st.UpdateLabel("Urgent", &taken, nil); labelErrorCode(err) != "label_name_taken" {
		t.Fatalf("expected label_name_taken, got %v", err)
	}
	upper := "URGENT"
	result, err := st.UpdateLabel("Urgent", &upper, nil)
	if err != nil {
		t.Fatalf("case-only rename: %v", err)
	}
	if result.PreviousName != "Urgent" || len(result.Workspaces) != 1 {
		t.Fatalf("case-only rename should rewrite the assignment: %+v", result)
	}
	if got := labelsOf(t, st, ids[0]); !slices.Equal(got, []string{"URGENT", "Frontend"}) {
		t.Fatalf("assignment after case-only rename: %v", got)
	}
}

func TestUpdateRefusesAnUnknownLabelInsteadOfCreatingIt(t *testing.T) {
	st, _ := newLabelStore(t, 1)
	red := "red"
	if _, err := st.UpdateLabel("Ghost", nil, &red); labelErrorCode(err) != "label_not_found" {
		t.Fatalf("expected label_not_found, got %v", err)
	}
	empty := " "
	if _, err := st.UpdateLabel("Ghost", &empty, nil); labelErrorCode(err) != "label_name_empty" {
		t.Fatalf("expected label_name_empty for a blank new name, got %v", err)
	}
	if names := catalogNames(st); len(names) != 0 {
		t.Fatalf("update created a label: %v", names)
	}
}

func TestRecolourIsCatalogOnlyAndANoOpChangesNothing(t *testing.T) {
	st, ids := newLabelStore(t, 1)
	assign(t, st, ids[0], "Urgent", "red", true)

	amber := "amber"
	result, err := st.UpdateLabel("Urgent", nil, &amber)
	if err != nil {
		t.Fatalf("recolour: %v", err)
	}
	if !result.Changed || result.PreviousName != "" || len(result.Workspaces) != 0 || result.Label.Color != "amber" {
		t.Fatalf("recolour result: %+v", result)
	}
	same := "Urgent"
	noop, err := st.UpdateLabel("Urgent", &same, &amber)
	if err != nil {
		t.Fatalf("no-op update: %v", err)
	}
	if noop.Changed || len(noop.Workspaces) != 0 {
		t.Fatalf("an update that changes nothing reported a change: %+v", noop)
	}
}

func TestDeleteRemovesTheLabelEverywhereByKey(t *testing.T) {
	st, ids := newLabelStore(t, 2)
	assign(t, st, ids[0], "Urgent", "red", true)
	assign(t, st, ids[0], "Frontend", "sky", true)
	assign(t, st, ids[1], "Urgent", "red", true)

	if count, err := st.InspectLabelUsage(" URGENT "); err != nil || count != 2 {
		t.Fatalf("inspect: %d %v", count, err)
	}
	result, err := st.DeleteLabel("urgent")
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if result.DeletedName != "Urgent" || len(result.Workspaces) != 2 {
		t.Fatalf("delete result: %+v", result)
	}
	if got := labelsOf(t, st, ids[0]); !slices.Equal(got, []string{"Frontend"}) {
		t.Fatalf("labels after delete: %v", got)
	}
	if got := labelsOf(t, st, ids[1]); len(got) != 0 {
		t.Fatalf("last label should leave no labels: %v", got)
	}
	if names := catalogNames(st); len(names) != 1 || names["Frontend"] != "sky" {
		t.Fatalf("catalog after delete: %v", names)
	}

	missing, err := st.DeleteLabel("Ghost")
	if err != nil || missing.DeletedName != "" || len(missing.Workspaces) != 0 {
		t.Fatalf("deleting an unknown label should change nothing: %+v %v", missing, err)
	}
	if _, err := st.InspectLabelUsage(""); labelErrorCode(err) != "label_name_empty" {
		t.Fatalf("expected label_name_empty from inspect, got %v", err)
	}
}
