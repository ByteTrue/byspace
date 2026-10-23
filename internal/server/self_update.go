package server

import (
	"context"
	"encoding/json"

	"github.com/ByteTrue/byspace/internal/selfupdate"
)

// handleDaemonUpdate replaces the daemon binary with a newer release.
//
// Previously this answered `success: true` without doing anything. A user who asked for an update
// got a confirmation and stayed on the old version — the worst shape of a stub, because the
// failure is invisible until they check the version.
//
// The replacement does not affect the running process: the new file is in place and the daemon
// keeps executing the old one until it restarts. The response says so via `restartRequired` rather
// than pretending the update is live.
func (s *Server) handleDaemonUpdate(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string `json:"requestId"`
		// Version pins a release; empty means the newest.
		Version string `json:"version"`
	}
	_ = json.Unmarshal(raw, &req)

	updater := &selfupdate.Updater{
		CurrentVersion: s.version,
		TargetVersion:  req.Version,
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
}
