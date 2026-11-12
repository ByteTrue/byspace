package server

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/ByteTrue/byspace/internal/hostsync"
)

// hostSyncStore opens this daemon's replica on first use.
//
// Lazily, like tunnelRegistry: a daemon nobody syncs with never creates the file. An unreadable
// file is returned as an error on every call instead of being cached as empty; see hostsync.Open.
func (s *Server) hostSyncStore() (*hostsync.Store, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hostSync != nil {
		return s.hostSync, nil
	}
	store, err := hostsync.Open(s.homeDir, s.serverID)
	if err != nil {
		return nil, err
	}
	s.hostSync = store
	return store, nil
}

// handleHostSyncExchange is the single sync RPC: the client hands over records it carried from
// other replicas plus its own edits, and gets the merged replica back. One round trip covers
// pull, push, and relaying between daemons, so the client never has to diff.
func (s *Server) handleHostSyncExchange(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		RequestID string            `json:"requestId"`
		Records   []hostsync.Record `json:"records"`
		Changes   []hostsync.Change `json:"changes"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return
	}
	reply := func(records []hostsync.Record, errMsg string) {
		payload := map[string]any{"requestId": req.RequestID, "records": records}
		if errMsg != "" {
			payload["error"] = errMsg
		}
		_ = sendSessionMsg(ctx, sink, "hosts.sync.exchange.response", payload)
	}

	store, err := s.hostSyncStore()
	if err != nil {
		slog.Error("host sync: replica unavailable", "err", err)
		reply([]hostsync.Record{}, err.Error())
		return
	}
	records, err := store.Exchange(req.Records, req.Changes)
	if err != nil {
		reply([]hostsync.Record{}, err.Error())
		return
	}
	reply(records, "")
}
