package server

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/schedule"
	"github.com/ByteTrue/byspace/internal/store"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func newScheduleTestServer(t *testing.T) (*Server, string, store.WorkspaceRecord) {
	t.Helper()
	// The mock provider exists only in a development build.
	t.Setenv("BYSPACE_NODE_ENV", "development")
	srv := newTestServer(t, t.TempDir())
	project := t.TempDir()
	_, main, err := srv.store.EnsureWorkspaceForCwd(project)
	if err != nil {
		t.Fatal(err)
	}
	return srv, project, main
}

func workspaceByID(t *testing.T, srv *Server, id string) store.WorkspaceRecord {
	t.Helper()
	record, ok := srv.workspaceRecord(id)
	if !ok {
		t.Fatalf("workspace %s not found", id)
	}
	return record
}

// A new-agent run starts the configured provider and model in a workspace of its own and archives
// that workspace when it is done. The project's existing workspace is never touched: the Go runner
// used to start pi in it and then archive it.
func TestScheduledRunUsesItsOwnWorkspaceAndConfig(t *testing.T) {
	srv, project, main := newScheduleTestServer(t)
	title := "Nightly check"
	created, err := srv.schedules.Create(schedule.CreateInput{
		Prompt:  "Summarize the repository",
		Cadence: schedule.Cadence{Type: "cron", Expression: "0 9 * * *"},
		Target: schedule.Target{Type: "new-agent", Config: &schedule.TargetConfig{
			Provider:         "mock",
			Cwd:              project,
			Model:            "e2e-fast-stream",
			ThinkingOptionID: "high",
			ModeID:           "approval-test",
			Title:            &title,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	got, err := srv.schedules.RunOnce(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := got.Runs[0]
	if run.Status != "succeeded" || run.Error != nil {
		t.Fatalf("run = %+v (error %v)", run, derefOr(run.Error, ""))
	}
	if run.AgentID == nil || !uuidPattern.MatchString(*run.AgentID) {
		t.Fatalf("run agent id = %v, want a UUID", run.AgentID)
	}
	if run.Output == nil || strings.TrimSpace(*run.Output) == "" {
		t.Fatal("the run recorded no output")
	}
	if run.WorkspaceID == nil || *run.WorkspaceID == main.WorkspaceID {
		t.Fatalf("run workspace = %v, want a new one (main is %s)", run.WorkspaceID, main.WorkspaceID)
	}

	agent, err := srv.store.GetAgent(*run.AgentID)
	if err != nil || agent == nil {
		t.Fatalf("agent record: %v", err)
	}
	if agent.Provider != "mock" || agent.Config == nil || derefOr(agent.Config.Model, "") != "e2e-fast-stream" ||
		derefOr(agent.Config.ThinkingOptionID, "") != "high" || derefOr(agent.Config.ModeID, "") != "approval-test" {
		t.Fatalf("agent config = provider %s %+v", agent.Provider, agent.Config)
	}
	if derefOr(agent.Title, "") != "Nightly check" || agent.WorkspaceID != *run.WorkspaceID {
		t.Fatalf("agent title %v workspace %s", agent.Title, agent.WorkspaceID)
	}
	if agent.Labels["byspace.schedule-id"] != created.ID || agent.Labels["byspace.schedule-run"] != run.ID {
		t.Fatalf("agent labels = %v", agent.Labels)
	}

	if runWorkspace := workspaceByID(t, srv, *run.WorkspaceID); runWorkspace.ArchivedAt == nil || runWorkspace.Cwd != main.Cwd {
		t.Fatalf("run workspace: archived %v cwd %s", runWorkspace.ArchivedAt, runWorkspace.Cwd)
	}
	if mainAfter := workspaceByID(t, srv, main.WorkspaceID); mainAfter.ArchivedAt != nil {
		t.Fatal("the project's own workspace was archived")
	}
	if got.Status != "active" || *got.NextRunAt != *created.NextRunAt {
		t.Fatalf("a manual run moved the schedule: %s %v", got.Status, got.NextRunAt)
	}
}

// archiveOnFinish false keeps the run's workspace for inspection.
func TestScheduledRunKeepsItsWorkspaceWhenAsked(t *testing.T) {
	srv, project, _ := newScheduleTestServer(t)
	keep := false
	created, err := srv.schedules.Create(schedule.CreateInput{
		Prompt:  "Summarize the repository",
		Cadence: schedule.Cadence{Type: "cron", Expression: "0 9 * * *"},
		Target: schedule.Target{Type: "new-agent", Config: &schedule.TargetConfig{
			Provider: "mock", Cwd: project, Model: "e2e-fast-stream", ArchiveOnFinish: &keep,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	got, err := srv.schedules.RunOnce(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := got.Runs[0]
	if run.Status != "succeeded" || run.WorkspaceID == nil {
		t.Fatalf("run = %+v", run)
	}
	if ws := workspaceByID(t, srv, *run.WorkspaceID); ws.ArchivedAt != nil {
		t.Fatal("the run's workspace was archived although the schedule keeps it")
	}
}

// A run whose directory is gone ends the schedule; one whose provider fails keeps it, and archives
// the workspace the failed run created.
func TestScheduledRunFailures(t *testing.T) {
	srv, project, _ := newScheduleTestServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	gone, err := srv.schedules.Create(schedule.CreateInput{
		Prompt:  "p",
		Cadence: schedule.Cadence{Type: "cron", Expression: "0 9 * * *"},
		Target:  schedule.Target{Type: "new-agent", Config: &schedule.TargetConfig{Provider: "mock", Cwd: project + "/missing"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := srv.schedules.RunOnce(ctx, gone.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "completed" || got.Runs[0].Status != "failed" || !strings.Contains(derefOr(got.Runs[0].Error, ""), "no longer exists") {
		t.Fatalf("missing cwd: %+v %v", got.Runs[0], derefOr(got.Runs[0].Error, ""))
	}

	failing, err := srv.schedules.Create(schedule.CreateInput{
		Prompt:  "p",
		Cadence: schedule.Cadence{Type: "cron", Expression: "0 9 * * *"},
		Target:  schedule.Target{Type: "new-agent", Config: &schedule.TargetConfig{Provider: "no-such-provider", Cwd: project}},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = srv.schedules.RunOnce(ctx, failing.ID)
	if err != nil {
		t.Fatal(err)
	}
	run := got.Runs[0]
	if got.Status != "active" || run.Status != "failed" || run.WorkspaceID == nil {
		t.Fatalf("provider failure: %+v", run)
	}
	if ws := workspaceByID(t, srv, *run.WorkspaceID); ws.ArchivedAt == nil {
		t.Fatal("a run that never got an agent keeps its workspace")
	}
}

// A heartbeat prompts its agent with the fire notice; archiving the agent ends the heartbeat.
func TestHeartbeatPromptsItsAgent(t *testing.T) {
	srv, project, main := newScheduleTestServer(t)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	model := "e2e-fast-stream"
	rec := store.AgentRecord{
		ID: newAgentID(), Provider: "mock", Cwd: project, WorkspaceID: main.WorkspaceID,
		CreatedAt: now, UpdatedAt: now, LastStatus: "idle", Config: &store.AgentConfig{Model: &model},
	}
	mp, err := srv.startOrGetPiAgent(rec)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.store.UpsertAgent(mp.record); err != nil {
		t.Fatal(err)
	}
	name := "standup"
	beat, err := srv.schedules.Create(schedule.CreateInput{
		Name:    &name,
		Prompt:  "Post the standup",
		Cadence: schedule.Cadence{Type: "cron", Expression: "0 9 * * *"},
		Target:  schedule.Target{Type: "agent", AgentID: rec.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	got, err := srv.schedules.RunOnce(ctx, beat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Runs[0].Status != "succeeded" || derefOr(got.Runs[0].AgentID, "") != rec.ID {
		t.Fatalf("heartbeat run = %+v %v", got.Runs[0], derefOr(got.Runs[0].Error, ""))
	}
	prompted := false
	for _, entry := range mp.session.Timeline() {
		if entry.Item.Type == "user_message" && strings.Contains(entry.Item.Text, `Schedule "standup" fired (id=`+beat.ID) &&
			strings.Contains(entry.Item.Text, "Post the standup") {
			prompted = true
		}
	}
	if !prompted {
		t.Fatal("the agent never received the fire notice")
	}

	srv.noteAgentArchived(rec.ID)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if after, _ := srv.schedules.Inspect(beat.ID); after.Status == "completed" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("archiving the agent did not end its heartbeat")
}
