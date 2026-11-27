package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
	"github.com/coder/websocket"
)

func TestChiefAgentCredentialCannotApproveLanding(t *testing.T) {
	t.Setenv("BYSPACE_NODE_ENV", "development")
	for _, role := range []string{chief.RoleAuthor, chief.RoleChief} {
		t.Run(role, func(t *testing.T) {
			f := newChiefLandingFixture(t, true)
			setDaemonPassword(t, f.srv, "operator-password")
			labels := chief.BuildOrchestrationLabels(f.missionID, f.threadID, role, true)
			if role == chief.RoleChief {
				labels = chief.BuildOrchestrationLabels(f.missionID, "", role, true)
			}
			rec := store.AgentRecord{ID: "agt_decision_" + role, Provider: "mock", Cwd: t.TempDir(), Labels: labels}
			if err := f.srv.store.UpsertAgent(rec); err != nil {
				t.Fatal(err)
			}
			if role == chief.RoleChief {
				if _, err := f.srv.chief.store.UpdateMission(f.missionID, func(m *chief.Mission) error {
					m.ChiefAgentID = rec.ID
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			agentToken, err := f.srv.ensureAgentCredential(rec.ID)
			if err != nil {
				t.Fatal(err)
			}
			land := landingLand(t, f, f.threadID)
			if got := landingError(land); got != "" {
				t.Fatalf("request landing approval: %s", got)
			}
			pending := f.mission(t).PendingDecision
			if pending == nil || pending.Kind != chief.LandingDecisionKind {
				t.Fatalf("landing approval was not requested: %+v", pending)
			}
			before := f.head(t)
			httpServer := httptest.NewServer(f.srv)
			defer httpServer.Close()

			agentWS := dialChiefDecisionSocket(t, httpServer.URL, agentToken)
			agentResponse := chiefDecisionRPCOverSocket(t, agentWS, pending.ID)
			_ = agentWS.Close(websocket.StatusNormalClosure, "done")
			if got := landingError(agentResponse); !strings.Contains(got, "trusted operator") {
				t.Fatalf("%s credential approved landing: error=%q response=%v", role, got, agentResponse)
			}
			afterDenied := f.mission(t)
			if afterDenied.PendingDecision == nil || afterDenied.PendingDecision.ResolvedAt != nil {
				t.Fatalf("%s credential resolved the pending decision: %+v", role, afterDenied.PendingDecision)
			}
			if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusReadyToLand {
				t.Fatalf("%s credential changed thread status to %s", role, got)
			}
			if got := f.head(t); got != before {
				t.Fatalf("%s credential executed landing: target %s -> %s", role, before, got)
			}

			operatorWS := dialChiefDecisionSocket(t, httpServer.URL, "operator-password")
			operatorResponse := chiefDecisionRPCOverSocket(t, operatorWS, pending.ID)
			_ = operatorWS.Close(websocket.StatusNormalClosure, "done")
			if got := landingError(operatorResponse); got != "" {
				t.Fatalf("trusted operator could not approve landing: %s", got)
			}
			if got := f.thread(t, f.threadID).Status; got != chief.ThreadStatusLanded {
				t.Fatalf("trusted operator landing status = %s, want landed", got)
			}
			if got := f.head(t); got == before {
				t.Fatal("trusted operator approval did not advance the target")
			}
		})
	}
}

func dialChiefDecisionSocket(t *testing.T, serverURL, credential string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	t.Cleanup(cancel)
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(serverURL, "http")+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + credential}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.SetReadLimit(1 << 20)
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","clientId":"chief-decision-auth-test","protocolVersion":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.Read(ctx); err != nil {
		t.Fatal(err)
	}
	return ws
}

func chiefDecisionRPCOverSocket(t *testing.T, ws *websocket.Conn, decisionID string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	raw, _ := json.Marshal(map[string]any{
		"type": "session",
		"message": map[string]any{
			"type": "chief.mission.resolve_decision.request", "requestId": "resolve-" + decisionID,
			"missionId": "mis_landing_test", "decisionId": decisionID, "optionId": chief.LandingOptionApprove,
		},
	})
	if err := ws.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), "chief.mission.resolve_decision.response") {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		message, _ := frame["message"].(map[string]any)
		payload, _ := message["payload"].(map[string]any)
		if payload == nil {
			payload, _ = frame["payload"].(map[string]any)
		}
		if payload == nil {
			t.Fatalf("decision response has no payload: %s", data)
		}
		return payload
	}
}
