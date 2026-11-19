package server

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ByteTrue/byspace/internal/selfupdate"
)

// handleDaemonUpdate replaces the daemon binary with a newer release and hands a restart request
// to the process owner once the new binary is in place.
func (s *Server) handleDaemonUpdate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		// Version pins a release; empty means the newest.
		Version string `json:"version"`
	}
	_ = json.Unmarshal(raw, &req)

	s.selfUpdateMu.Lock()
	if s.selfUpdateBusy {
		s.selfUpdateMu.Unlock()
		_ = sendSessionMsg(ctx, sink, "rpc_error", map[string]any{
			"requestId":   req.RequestID,
			"requestType": "daemon.update.request",
			"error":       selfupdate.ErrInProgress.Error(),
			"code":        "already_updating",
		})
		return
	}
	s.selfUpdateBusy = true
	execPath := s.selfUpdateExecutable
	fetchFn := s.selfUpdateFetch
	s.selfUpdateMu.Unlock()
	defer func() {
		s.selfUpdateMu.Lock()
		s.selfUpdateBusy = false
		s.selfUpdateMu.Unlock()
	}()

	updater := &selfupdate.Updater{
		CurrentVersion: s.version,
		ExecutablePath: execPath,
		TargetVersion:  req.Version,
		Fetch:          fetchFn,
		// The client shows the four phases as the button label while the request is in flight, so
		// they travel as `daemon.update.progress` rather than only landing in the log. Without
		// them the button sits on "Preparing update..." until the response arrives.
		OnProgress: func(phase selfupdate.Phase) {
			_ = sendSessionMsg(ctx, sink, "daemon.update.progress", map[string]any{
				"requestId": req.RequestID,
				"phase":     string(phase),
			})
		},
	}

	result, err := updater.Update(ctx)
	if err != nil {
		if errors.Is(err, selfupdate.ErrInProgress) {
			_ = sendSessionMsg(ctx, sink, "rpc_error", map[string]any{
				"requestId":   req.RequestID,
				"requestType": "daemon.update.request",
				"error":       err.Error(),
				"code":        "already_updating",
			})
			return
		}
		_ = sendSessionMsg(ctx, sink, "daemon.update.response", map[string]any{
			"requestId":       req.RequestID,
			"success":         false,
			"error":           err.Error(),
			"previousVersion": s.version,
			"newVersion":      nil,
		})
		return
	}

	payload := map[string]any{
		"requestId":       req.RequestID,
		"success":         result.Success,
		"previousVersion": result.PreviousVersion,
	}
	// `error` and `newVersion` are nullable, so nil is the correct absent value here rather than a
	// missing key: the schema declares them nullable, not optional.
	if result.Error != "" {
		payload["error"] = result.Error
	} else {
		payload["error"] = nil
	}
	if result.NewVersion != "" {
		payload["newVersion"] = result.NewVersion
	} else {
		payload["newVersion"] = nil
	}
	payload["restartRequired"] = result.RestartRequired

	_ = sendSessionMsg(ctx, sink, "daemon.update.response", payload)
	if result.Success && result.RestartRequired {
		s.requestControl(ControlRequest{
			Restart: true,
			Reason:  "daemon_update",
		})
	}
}
