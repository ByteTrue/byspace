package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"

	agentmode "github.com/ByteTrue/byspace/internal/agent/mode"
	"github.com/ByteTrue/byspace/internal/agent/pi"
	"github.com/ByteTrue/byspace/internal/agent/providers"
	"github.com/ByteTrue/byspace/internal/chief"
	"github.com/ByteTrue/byspace/internal/store"
)

// AgentHotSwapRequest selects a bound agent and target profile. An empty
// ProfileID asks the routing config for the next available fallback.
type AgentHotSwapRequest struct {
	AgentID       string
	ThreadID      string
	ProfileID     string
	MissionID     string
	CallerAgentID string
	Reason        string
}

// AgentHotSwapResult reports the committed binding. ReplacementAgentID equals
// PreviousAgentID for a same-provider swap.
type AgentHotSwapResult struct {
	Accepted           bool
	PreviousAgentID    string
	ReplacementAgentID string
	ProfileID          string
	Mission            *chief.Mission
}

var agentHotSwapThreadLocks sync.Map

func tryLockAgentHotSwapThread(threadID string) (func(), bool) {
	value, _ := agentHotSwapThreadLocks.LoadOrStore(threadID, new(sync.Mutex))
	mu := value.(*sync.Mutex)
	if !mu.TryLock() {
		return nil, false
	}
	return mu.Unlock, true
}

// AgentHotSwapService owns provider replacement and the atomic mission rebind.
type AgentHotSwapService struct {
	bridge         *chiefBridge
	startAgent     func(store.AgentRecord) (*managedPi, error)
	applyOrRestart func(context.Context, *managedPi, error) error
	upsertAgent    func(store.AgentRecord) error
}

func NewAgentHotSwapService(bridge *chiefBridge) *AgentHotSwapService {
	return &AgentHotSwapService{
		bridge:         bridge,
		startAgent:     bridge.srv.startOrGetPiAgent,
		applyOrRestart: bridge.srv.applyOrRestart,
		upsertAgent:    bridge.srv.store.UpsertAgent,
	}
}

// HotSwap applies a profile in place when possible, or starts a replacement and
// atomically moves the mission binding. The replacement is discarded on every
// failure before the mission commit.
func (s *AgentHotSwapService) HotSwap(ctx context.Context, req AgentHotSwapRequest) (AgentHotSwapResult, error) {
	result := AgentHotSwapResult{PreviousAgentID: req.AgentID, ReplacementAgentID: req.AgentID, ProfileID: req.ProfileID}
	if s == nil || s.bridge == nil || s.bridge.srv == nil || s.bridge.store == nil {
		return result, fmt.Errorf("hot swap service is unavailable")
	}
	if strings.TrimSpace(req.AgentID) == "" || strings.TrimSpace(req.ThreadID) == "" {
		return result, fmt.Errorf("agentId and threadId are required")
	}
	unlock, ok := tryLockAgentHotSwapThread(req.ThreadID)
	if !ok {
		return result, fmt.Errorf("hot swap already in progress for thread %s", req.ThreadID)
	}
	defer unlock()
	m, err := s.bridge.store.FindMissionByThread(req.ThreadID)
	if err != nil {
		return result, err
	}
	if req.MissionID != "" && req.MissionID != m.ID {
		return result, fmt.Errorf("thread %s does not belong to mission %s", req.ThreadID, req.MissionID)
	}
	threadIndex, binding, err := hotSwapBinding(m, req.ThreadID, req.AgentID)
	if err != nil {
		return result, err
	}
	mp, err := s.bridge.srv.ensureAgentLoaded(req.AgentID)
	if err != nil {
		return result, err
	}
	if hotSwapAgentActive(mp) {
		return result, fmt.Errorf("agent %s has an active turn", req.AgentID)
	}
	profile, err := s.targetProfile(binding, req.ProfileID)
	if err != nil {
		return result, err
	}
	result.ProfileID = profile.ID
	targetProvider := profile.Provider
	if targetProvider == "" {
		targetProvider = mp.record.Provider
	}
	profile.Provider = targetProvider
	if hotSwapProviderID(targetProvider) == hotSwapProviderID(mp.record.Provider) {
		return s.swapSameProvider(ctx, m, threadIndex, binding, mp, profile, req)
	}
	return s.swapCrossProvider(ctx, m, threadIndex, binding, mp, profile, req)
}

func (s *Server) handleChiefAgentHotSwap(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID     string `json:"requestId"`
		AgentID       string `json:"agentId"`
		ThreadID      string `json:"threadId"`
		ProfileID     string `json:"profileId"`
		MissionID     string `json:"missionId"`
		CallerAgentID string `json:"callerAgentId"`
		Reason        string `json:"reason"`
	}
	_ = json.Unmarshal(raw, &req)
	result := AgentHotSwapResult{PreviousAgentID: req.AgentID, ProfileID: req.ProfileID}
	actorID, actorErr := s.verifiedChiefActor(sink, req.CallerAgentID, false)
	var err error
	if s.chief == nil {
		err = fmt.Errorf("chief service is unavailable")
	} else if actorErr != nil {
		err = actorErr
	} else {
		result, err = NewAgentHotSwapService(s.chief).HotSwap(ctx, AgentHotSwapRequest{
			AgentID: req.AgentID, ThreadID: req.ThreadID, ProfileID: req.ProfileID,
			MissionID: req.MissionID, CallerAgentID: actorID, Reason: req.Reason,
		})
	}
	var replacementAgentID any
	if result.Accepted && result.ReplacementAgentID != "" {
		replacementAgentID = result.ReplacementAgentID
	}
	var mission any
	if result.Mission != nil {
		snapshot := s.chief.missionSnapshot(*result.Mission)
		mission = &snapshot
	}
	var responseErr any
	if err != nil {
		responseErr = err.Error()
	}
	_ = sendSessionMsg(ctx, sink, "chief.agent.hotswap.response", map[string]any{
		"requestId": req.RequestID, "accepted": err == nil && result.Accepted,
		"previousAgentId": result.PreviousAgentID, "replacementAgentId": replacementAgentID,
		"profileId": result.ProfileID, "mission": mission, "error": responseErr,
	})
}

type agentHotSwapBinding struct {
	role           string
	thread         chief.Thread
	cursor         int64
	currentProfile string
}

func hotSwapBinding(m *chief.Mission, threadID, agentID string) (int, agentHotSwapBinding, error) {
	for i := range m.Threads {
		t := m.Threads[i]
		if t.ID != threadID {
			continue
		}
		b := agentHotSwapBinding{thread: t, cursor: m.Cursors[agentID]}
		switch agentID {
		case t.AuthorAgentID:
			b.role, b.currentProfile = "author", t.AuthorProfileID
		case t.VerifierAgentID:
			b.role, b.currentProfile = "verifier", t.VerifierProfileID
		case t.IntegratorAgentID:
			b.role, b.currentProfile = "integrator", t.AuthorProfileID
		default:
			return 0, b, fmt.Errorf("agent %s is not bound to thread %s", agentID, threadID)
		}
		return i, b, nil
	}
	return 0, agentHotSwapBinding{}, fmt.Errorf("thread %s not found in mission %s", threadID, m.ID)
}

func (s *AgentHotSwapService) targetProfile(binding agentHotSwapBinding, requested string) (chief.Profile, error) {
	cfg := s.bridge.srv.store.LoadDaemonConfig()
	routing, profiles, err := chief.ParseRoutingConfig(cfg)
	if err != nil {
		return chief.Profile{}, err
	}
	if binding.role == "integrator" {
		return chief.Profile{}, fmt.Errorf("integrator hot swap is not supported")
	}
	if binding.thread.ID == "" || binding.currentProfile == "" {
		return chief.Profile{}, fmt.Errorf("complete thread and profile binding is required")
	}
	var profile chief.Profile
	if requested = strings.TrimSpace(requested); requested != "" {
		for _, candidate := range profiles {
			if candidate.ID == requested {
				profile = candidate
				break
			}
		}
		if profile.ID == "" {
			return chief.Profile{}, fmt.Errorf("profile %q not found", requested)
		}
	} else {
		excluded := map[string]bool{binding.currentProfile: true}
		counterpartTier := binding.thread.VerifierTier
		if binding.role == chief.RoleVerifier {
			counterpartTier = binding.thread.AuthorTier
		}
		profile, err = chief.ResolveFallbackForRole(binding.role, counterpartTier, routing, profiles, excluded, s.bridge.isProviderReady)
		if err != nil {
			return chief.Profile{}, err
		}
	}
	if !s.bridge.isProviderReady(profile.Provider) {
		return chief.Profile{}, fmt.Errorf("provider %s is not configured", profile.Provider)
	}
	if binding.role == "verifier" {
		if err := chief.ValidateVerifierTier(binding.thread.AuthorTier, profile.Tier); err != nil {
			return chief.Profile{}, err
		}
	} else if binding.thread.VerifierTier != "" {
		if err := chief.ValidateVerifierTier(profile.Tier, binding.thread.VerifierTier); err != nil {
			return chief.Profile{}, err
		}
	}
	return profile, nil
}

func hotSwapProviderID(provider string) string {
	if provider == "" {
		return "pi"
	}
	return provider
}

func hotSwapAgentActive(mp *managedPi) bool {
	if mp == nil || mp.session == nil {
		return false
	}
	if mp.record.LastStatus == "running" || mp.session.Status() == "running" {
		return true
	}
	state, err := mp.session.GetState(context.Background())
	if err != nil {
		return true
	}
	return state != nil && (state.IsStreaming || state.IsCompacting)
}

func (s *AgentHotSwapService) swapSameProvider(ctx context.Context, m *chief.Mission, threadIndex int, binding agentHotSwapBinding, mp *managedPi, profile chief.Profile, req AgentHotSwapRequest) (AgentHotSwapResult, error) {
	result := AgentHotSwapResult{PreviousAgentID: mp.record.ID, ReplacementAgentID: mp.record.ID, ProfileID: profile.ID}
	if err := s.validateHotSwapBinding(m.ID, threadIndex, binding, mp.record); err != nil {
		return result, err
	}
	mode, err := s.resolveMode(profile.Provider, profile.ModeID, mp.record.ID)
	if err != nil {
		return result, err
	}
	oldRecord := mp.record
	rollback := func(cause error) (AgentHotSwapResult, error) {
		if restoreErr := s.restoreSameProvider(ctx, mp, oldRecord); restoreErr != nil {
			return result, errors.Join(cause, fmt.Errorf("same-provider rollback: %w", restoreErr))
		}
		return result, cause
	}
	nextRecord := oldRecord
	nextRecord.Config = hotSwapConfig(oldRecord.Config, profile, mode, true)
	applyReadOnlyVerifierPostureWithConfig(&nextRecord, s.bridge.srv.providerConfigFor(nextRecord.Provider))
	nextRecord.LastModeID = stringPointer(derefStr(nextRecord.Config.ModeID))
	nextRecord.LastStatus = "idle"
	nextRecord.LastError = nil
	nextRecord.RequiresAttention = false
	nextRecord.AttentionReason = nil
	nextRecord.AttentionTimestamp = nil
	var needsRestart bool
	if !reflect.DeepEqual(providerOptionsOf(oldRecord), providerOptionsOf(nextRecord)) {
		needsRestart = true
	}
	apply := func(applyErr error) bool {
		if applyErr == nil {
			return true
		}
		if errors.Is(applyErr, providers.ErrSettingNeedsRestart) {
			needsRestart = true
			return true
		}
		err = applyErr
		return false
	}
	if profile.Model != "" {
		providerID, modelID, resolveErr := providers.ResolveModelIdentity(mp.record.Provider, profile.Model, providerOptionsOf(mp.record))
		if resolveErr != nil {
			return result, resolveErr
		}
		if _, setErr := mp.session.SetModel(ctx, providerID, modelID); !apply(setErr) {
			return rollback(err)
		}
	}
	if profile.ThinkingOptionID != "" {
		if !apply(mp.session.SetThinkingLevel(ctx, profile.ThinkingOptionID)) {
			return rollback(err)
		}
	}
	if effectiveMode := derefStr(nextRecord.Config.ModeID); effectiveMode != "" {
		if setter, ok := mp.session.(providers.ModeSetter); ok {
			if !apply(setter.SetMode(ctx, effectiveMode)) {
				return rollback(err)
			}
		} else {
			needsRestart = true
		}
	}
	if nextRecord.Config.FeatureValues != nil {
		if setter, ok := mp.session.(providers.FeatureValueSetter); ok {
			setter.SetFeatureValues(cloneHotSwapMap(nextRecord.Config.FeatureValues))
		} else {
			needsRestart = true
		}
	}
	nextRecord.UpdatedAt = hotSwapTimestamp()
	mp.record = nextRecord
	if needsRestart {
		if restartErr := s.applyOrRestart(ctx, mp, providers.ErrSettingNeedsRestart); restartErr != nil {
			return rollback(restartErr)
		}
		s.bridge.srv.mu.Lock()
		restarted := s.bridge.srv.agents[mp.record.ID]
		s.bridge.srv.mu.Unlock()
		if restarted == nil {
			return rollback(fmt.Errorf("restarted agent %s is unavailable", mp.record.ID))
		}
		mp = restarted
	}
	if err := s.upsertAgent(mp.record); err != nil {
		return rollback(err)
	}
	updated, err := s.rebindMission(m, threadIndex, binding, oldRecord, mp.record, profile)
	if err != nil {
		return rollback(err)
	}
	result.Accepted = true
	result.Mission = s.finishSwap(updated, binding, oldRecord, mp.record, profile, req)
	s.bridge.srv.broadcastAgentUpdate(mp.record)
	if s.bridge.router != nil {
		_ = s.bridge.router.RingBell(ctx, m.ID, mp.record.ID, "hot_swap")
	}
	return result, nil
}

func (s *AgentHotSwapService) validateHotSwapBinding(missionID string, threadIndex int, binding agentHotSwapBinding, oldRecord store.AgentRecord) error {
	current, err := s.bridge.store.GetMission(missionID)
	if err != nil {
		return err
	}
	_, err = hotSwapBoundThread(current, threadIndex, binding, oldRecord)
	return err
}

func (s *AgentHotSwapService) restoreSameProvider(ctx context.Context, mp *managedPi, oldRecord store.AgentRecord) error {
	mp.record = oldRecord
	restartErr := s.applyOrRestart(ctx, mp, providers.ErrSettingNeedsRestart)
	var rollbackErrs []error
	if restartErr != nil {
		rollbackErrs = append(rollbackErrs, fmt.Errorf("restore old runtime: %w", restartErr))
	}
	s.bridge.srv.mu.Lock()
	restored := s.bridge.srv.agents[oldRecord.ID]
	if restartErr == nil {
		if restored == nil {
			rollbackErrs = append(rollbackErrs, fmt.Errorf("restored agent %s is unavailable", oldRecord.ID))
		} else {
			restored.record = oldRecord
		}
	}
	s.bridge.srv.mu.Unlock()
	if err := s.upsertAgent(oldRecord); err != nil {
		rollbackErrs = append(rollbackErrs, fmt.Errorf("restore old agent record: %w", err))
	}
	return errors.Join(rollbackErrs...)
}

func (s *AgentHotSwapService) swapCrossProvider(ctx context.Context, m *chief.Mission, threadIndex int, binding agentHotSwapBinding, old *managedPi, profile chief.Profile, req AgentHotSwapRequest) (AgentHotSwapResult, error) {
	result := AgentHotSwapResult{PreviousAgentID: old.record.ID, ReplacementAgentID: old.record.ID, ProfileID: profile.ID}
	timeline := append([]pi.TimelineEntry(nil), old.session.Timeline()...)
	unread, err := s.bridge.store.ReadEventsForAgent(m.ID, old.record.ID, binding.cursor)
	if err != nil {
		return result, err
	}
	attachment, err := buildForkContextAttachment(timeline, nil, "", s.bridge.srv.epoch, derefStr(old.record.Title), old.record.Cwd)
	if err != nil {
		return result, err
	}
	mode, err := s.resolveMode(profile.Provider, profile.ModeID, old.record.ID)
	if err != nil {
		return result, err
	}
	now := hotSwapTimestamp()
	replacementRecord := old.record
	replacementRecord.ID = newAgentID()
	replacementRecord.Provider = profile.Provider
	replacementRecord.CreatedAt = now
	replacementRecord.UpdatedAt = now
	replacementRecord.LastStatus = "idle"
	replacementRecord.LastModeID = stringPointer(mode)
	replacementRecord.Config = hotSwapConfig(old.record.Config, profile, mode, false)
	replacementRecord.RuntimeInfo = nil
	replacementRecord.Persistence = nil
	replacementRecord.LastError = nil
	replacementRecord.Usage = nil
	replacementRecord.LastUserMessageAt = nil
	replacementRecord.RequiresAttention = false
	replacementRecord.AttentionReason = nil
	replacementRecord.AttentionTimestamp = nil
	replacementRecord.ArchivedAt = nil
	applyReadOnlyVerifierPostureWithConfig(&replacementRecord, s.bridge.srv.providerConfigFor(replacementRecord.Provider))
	replacement, err := s.startAgent(replacementRecord)
	if replacement == nil {
		if err == nil {
			err = fmt.Errorf("target provider returned no replacement session")
		}
		return result, err
	}
	if replacement != nil {
		committed := false
		defer func() {
			if !committed {
				s.bridge.srv.discardCreatedAgent(replacement, replacementRecord.ID)
			}
		}()
		if err != nil {
			return result, err
		}
		replacement.session.SeedTimeline(timeline)
		handoff := hotSwapHandoff(attachment.Attachment, unread)
		if strings.TrimSpace(handoff) != "" {
			clientMessageID := newMessageID()
			replacement.session.SetNextClientMessageID(clientMessageID)
			if err := replacement.session.Prompt(ctx, handoff, nil); err != nil {
				return result, err
			}
			s.bridge.srv.appendSubmittedPromptRow(replacement.record, replacement.session, clientMessageID, handoff)
		}
		replacement.record.UpdatedAt = hotSwapTimestamp()
		if err := s.bridge.srv.store.UpsertAgent(replacement.record); err != nil {
			return result, err
		}
		updated, err := s.rebindMission(m, threadIndex, binding, old.record, replacement.record, profile)
		if err != nil {
			return result, err
		}
		committed = true
		result.Accepted = true
		result.ReplacementAgentID = replacement.record.ID
		result.Mission = s.finishSwap(updated, binding, old.record, replacement.record, profile, req)
		s.archiveOldAgent(old)
		s.bridge.srv.broadcastAgentUpdate(replacement.record)
		if s.bridge.router != nil {
			_ = s.bridge.router.RingBell(ctx, m.ID, replacement.record.ID, "hot_swap")
		}
		return result, nil
	}
	return result, err
}

func (s *AgentHotSwapService) resolveMode(provider, requested, parentID string) (string, error) {
	input := s.bridge.srv.agentModeInput(provider, stringPointer(requested), &parentID)
	resolved, err := agentmode.Resolve(input)
	if err != nil || resolved == nil {
		return "", err
	}
	return *resolved, nil
}

func hotSwapBoundThread(current *chief.Mission, threadIndex int, binding agentHotSwapBinding, oldRecord store.AgentRecord) (*chief.Thread, error) {
	if current == nil || threadIndex >= len(current.Threads) || current.Threads[threadIndex].ID != binding.thread.ID {
		return nil, fmt.Errorf("stale hot swap thread binding")
	}
	t := &current.Threads[threadIndex]
	var boundID, boundProfile string
	switch binding.role {
	case "author":
		boundID, boundProfile = t.AuthorAgentID, t.AuthorProfileID
	case "verifier":
		boundID, boundProfile = t.VerifierAgentID, t.VerifierProfileID
	default:
		return nil, fmt.Errorf("unsupported hot swap role %q", binding.role)
	}
	if boundID != oldRecord.ID || boundProfile != binding.currentProfile || current.Cursors[oldRecord.ID] != binding.cursor {
		return nil, fmt.Errorf("stale hot swap binding for agent %s", oldRecord.ID)
	}
	return t, nil
}

func (s *AgentHotSwapService) rebindMission(m *chief.Mission, threadIndex int, binding agentHotSwapBinding, oldRecord, newRecord store.AgentRecord, profile chief.Profile) (*chief.Mission, error) {
	return s.bridge.store.UpdateMission(m.ID, func(current *chief.Mission) error {
		t, err := hotSwapBoundThread(current, threadIndex, binding, oldRecord)
		if err != nil {
			return err
		}
		tier, _ := chief.NormalizeTier(profile.Tier)
		switch binding.role {
		case "author":
			t.AuthorAgentID = newRecord.ID
			t.AuthorProfileID = profile.ID
			t.AuthorTier = tier
		case "verifier":
			t.VerifierAgentID = newRecord.ID
			t.VerifierProfileID = profile.ID
			t.VerifierTier = tier
		}
		if newRecord.ID != oldRecord.ID {
			if current.Cursors == nil {
				current.Cursors = make(map[string]int64)
			}
			current.Cursors[newRecord.ID] = binding.cursor
			delete(current.Cursors, oldRecord.ID)
			if current.RetiredAgents == nil {
				current.RetiredAgents = make(map[string]int64)
			}
			current.RetiredAgents[oldRecord.ID] = current.HeadSeq
			if bell := current.PendingBells[oldRecord.ID]; bell != nil {
				moved := *bell
				moved.AgentID = newRecord.ID
				if current.PendingBells == nil {
					current.PendingBells = make(map[string]*chief.PendingBell)
				}
				current.PendingBells[newRecord.ID] = &moved
			}
			delete(current.PendingBells, oldRecord.ID)
		}
		t.UpdatedAt = hotSwapTimestamp()
		return nil
	})
}

func (s *AgentHotSwapService) finishSwap(m *chief.Mission, binding agentHotSwapBinding, oldRecord, newRecord store.AgentRecord, profile chief.Profile, req AgentHotSwapRequest) *chief.Mission {
	actor := req.CallerAgentID
	event, err := s.bridge.store.AppendEvent(m.ID, chief.Event{
		ThreadID:      stringPointer(binding.thread.ID),
		Kind:          chief.EventHotSwapApplied,
		ActorAgentID:  stringPointer(actor),
		TargetAgentID: stringPointer(newRecord.ID),
		Summary:       fmt.Sprintf("Hot-swapped %s from %s to %s", oldRecord.ID, oldRecord.Provider, newRecord.Provider),
		Payload: map[string]any{
			"oldAgentId": oldRecord.ID,
			"newAgentId": newRecord.ID,
			"profileId":  profile.ID,
			"provider":   newRecord.Provider,
			"reason":     req.Reason,
		},
	})
	if err == nil {
		s.bridge.broadcastMissionUpdate(m, &event)
		if current, getErr := s.bridge.store.GetMission(m.ID); getErr == nil {
			return current
		}
	}
	return m
}

func (s *AgentHotSwapService) archiveOldAgent(old *managedPi) {
	_ = s.bridge.srv.revokeAgentCredential(old.record.ID)
	s.bridge.srv.mu.Lock()
	if s.bridge.srv.agents[old.record.ID] == old {
		delete(s.bridge.srv.agents, old.record.ID)
	}
	record := old.record
	s.bridge.srv.mu.Unlock()
	_ = old.session.Close()
	now := hotSwapTimestamp()
	record.LastStatus = "closed"
	record.UpdatedAt = now
	archived := store.BuildArchivedAgentRecord(record, now)
	if err := s.bridge.srv.store.UpsertAgent(archived); err == nil {
		old.record = archived
		s.bridge.srv.noteAgentArchived(archived.ID)
		s.bridge.srv.broadcastAgentUpdate(archived)
	}
}

func hotSwapConfig(old *store.AgentConfig, profile chief.Profile, mode string, sameProvider bool) *store.AgentConfig {
	cfg := &store.AgentConfig{}
	if old != nil {
		cfg.SystemPrompt = old.SystemPrompt
		cfg.MCPServers = old.MCPServers
		cfg.Role = old.Role
		cfg.Env = old.Env
		if sameProvider {
			cfg.ProviderOptions = cloneHotSwapMap(old.ProviderOptions)
		}
	}
	cfg.ModeID = stringPointer(mode)
	cfg.Model = stringPointer(profile.Model)
	cfg.ThinkingOptionID = stringPointer(profile.ThinkingOptionID)
	cfg.FeatureValues = cloneHotSwapMap(profile.FeatureValues)
	if !sameProvider {
		cfg.ProviderOptions = make(map[string]any)
	}
	return cfg
}

func cloneHotSwapMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func hotSwapHandoff(attachment map[string]any, unread []chief.Event) string {
	var b strings.Builder
	if text, _ := attachment["text"].(string); text != "" {
		b.WriteString(text)
	}
	if len(unread) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString("Unread mission events for the previous agent:\n")
		for _, event := range unread {
			fmt.Fprintf(&b, "- seq=%d kind=%s: %s\n", event.Seq, event.Kind, event.Summary)
		}
	}
	return b.String()
}

func hotSwapTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
