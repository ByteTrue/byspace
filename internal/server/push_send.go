package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/ByteTrue/byspace/internal/attention"
	"github.com/ByteTrue/byspace/internal/home"
	"github.com/ByteTrue/byspace/internal/push"
)

// Push delivery.
//
// The token store is opaque on purpose: a browser subscription and an Expo token are both
// strings, so one store serves both without a protocol change. Dispatch is by shape — JSON is a
// Web Push subscription, `ExponentPushToken[...]` is Expo.

// sendPushToAllTokens delivers payload to every registered token, pruning dead subscriptions.
func (s *Server) sendPushToAllTokens(ctx context.Context, payload map[string]any) int {
	tokens := s.readPushTokens()
	if len(tokens) == 0 {
		return 0
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return 0
	}

	keys := push.Keys{
		PublicKey:  s.vapidKeys.PublicKey,
		PrivateKey: s.vapidKeys.PrivateKey,
	}
	client := &push.Client{Keys: keys, HTTP: s.pushHTTPClient}

	delivered := 0
	var dead []string
	for _, token := range tokens {
		sub, parseErr := push.ParseSubscription(token)
		if parseErr != nil {
			// Not a browser subscription. Expo tokens are intentionally not delivered here:
			// that transport needs Expo's service, and pretending to deliver would make the
			// settings page report success for notifications nobody receives.
			continue
		}
		status, sendErr := client.Send(ctx, *sub, body)
		if sendErr != nil {
			if push.IsGone(status) {
				// Permanent: the browser unsubscribed or the endpoint expired.
				dead = append(dead, token)
			}
			continue
		}
		delivered++
	}

	if len(dead) > 0 {
		s.removePushTokens(dead)
	}
	return delivered
}

// readPushTokens loads the token list.
func (s *Server) readPushTokens() []string {
	raw, err := os.ReadFile(filepath.Join(s.homeDir, "push-tokens.json"))
	if err != nil {
		return nil
	}
	var tokens []string
	if json.Unmarshal(raw, &tokens) != nil {
		return nil
	}
	return tokens
}

// removePushTokens prunes tokens a push service reported as gone.
//
// Without this the store grows forever and every notification spends a round trip on an endpoint
// that will never accept one.
func (s *Server) removePushTokens(dead []string) {
	deadSet := make(map[string]bool, len(dead))
	for _, token := range dead {
		deadSet[token] = true
	}
	kept := make([]string, 0, len(dead))
	for _, token := range s.readPushTokens() {
		if !deadSet[token] {
			kept = append(kept, token)
		}
	}
	out, err := json.MarshalIndent(kept, "", "  ")
	if err != nil {
		return
	}
	_ = home.WriteAtomic(filepath.Join(s.homeDir, "push-tokens.json"), append(out, '\n'), 0o600)
}

// notifyAttention sends a push for an agent that needs the user.
//
// Gated by the attention policy: a present client gets the in-app notice instead, and an error
// never pushes (a failing provider would push on every retry).
func (s *Server) notifyAttention(agentID, reason, title, body string) {
	if !attention.IsPushEligibleReason(reason) {
		return
	}
	plan := s.attentionPlan(agentID)
	if !plan.ShouldPush {
		return
	}
	payload := map[string]any{
		"title":     title,
		"body":      body,
		"agentId":   agentID,
		"reason":    reason,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.sendPushToAllTokens(ctx, payload)
	}()
}

// attentionPlan evaluates the presence policy for one agent.
func (s *Server) attentionPlan(agentID string) attention.Plan {
	s.mu.Lock()
	states := s.clientPresence
	s.mu.Unlock()
	return attention.ComputePlan(states, &attention.FocusTarget{Kind: "agent", ID: agentID}, true, time.Now())
}
