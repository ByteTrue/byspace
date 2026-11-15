package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

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
	// This daemon's own record must describe a route the other devices can take. A client knows how
	// to reach the daemon on this machine (localhost), and that is exactly what it writes; replicated
	// to another machine, that route points at the other machine's own daemon.
	records = s.ensureSelfHostRecord(store, records)
	reply(records, "")
}

// ensureSelfHostRecord puts this daemon's relay route into its own host record.
//
// The record is written by clients (a local app only knows localhost), and every device in the chain
// adopts the replica. Without the relay connection the record teaches phones and other machines to
// dial their own localhost, which is the daemon on that machine, not this one. The relay route is the
// one the pairing offer already carries, so it is public information and safe to replicate.
func (s *Server) ensureSelfHostRecord(store *hostsync.Store, records []hostsync.Record) []hostsync.Record {
	if s.store == nil || s.serverID == "" {
		return records
	}
	relay := relayConfigFromStore(s.store.LoadDaemonConfig())
	// The relay client stays off without a password, so a route advertised in that state would not
	// answer. Do not add it.
	if !relay.Enabled || relay.PublicEndpoint == "" || s.PublicKeyB64() == "" || s.daemonPasswordHash() == "" {
		return records
	}

	useTLS := relay.PublicUseTLS
	connectionID := "relay:" + relay.PublicEndpoint
	if useTLS {
		connectionID = "relay:wss:" + relay.PublicEndpoint
	}
	relayConnection := map[string]any{
		"id":                 connectionID,
		"type":               "relay",
		"relayEndpoint":      relay.PublicEndpoint,
		"useTls":             useTLS,
		"daemonPublicKeyB64": s.PublicKeyB64(),
	}

	var self *hostsync.Record
	for i := range records {
		if records[i].Kind == hostsync.KindHost && records[i].ID == s.serverID {
			self = &records[i]
			break
		}
	}
	if self != nil && self.Deleted {
		return records
	}

	data := map[string]any{}
	if self != nil {
		if err := json.Unmarshal(self.Data, &data); err != nil {
			// A self record this daemon cannot parse is left alone rather than replaced: the client
			// owns its shape, and rewriting it would discard whatever else it carries.
			return records
		}
	}

	connections, _ := data["connections"].([]any)
	kept := make([]any, 0, len(connections)+1)
	hadCurrent := false
	for _, item := range connections {
		connection, ok := item.(map[string]any)
		if !ok {
			kept = append(kept, item)
			continue
		}
		if connection["type"] != "relay" {
			kept = append(kept, item)
			continue
		}
		// One relay route: the daemon is on one relay, and a route to an old one is dead weight.
		if strings.EqualFold(strings.TrimSpace(fmt.Sprint(connection["relayEndpoint"])), relay.PublicEndpoint) {
			hadCurrent = true
			kept = append(kept, relayConnection)
			continue
		}
	}
	if !hadCurrent {
		kept = append(kept, relayConnection)
	}
	data["connections"] = kept

	now := time.Now().UTC().Format(time.RFC3339)
	if label, _ := data["label"].(string); strings.TrimSpace(label) == "" {
		hostname, _ := os.Hostname()
		if strings.TrimSpace(hostname) == "" {
			hostname = s.serverID
		}
		data["label"] = hostname
	}
	if _, ok := data["appearance"]; !ok {
		data["appearance"] = map[string]any{"color": "none", "badgeDisplay": "auto"}
	}
	if _, ok := data["lifecycle"]; !ok {
		data["lifecycle"] = map[string]any{}
	}
	if _, ok := data["createdAt"].(string); !ok {
		data["createdAt"] = now
	}
	if preferred, _ := data["preferredConnectionId"].(string); strings.TrimSpace(preferred) == "" {
		data["preferredConnectionId"] = connectionID
	}

	encoded, err := json.Marshal(data)
	if err != nil {
		return records
	}
	// Nothing changed: do not bump the record's version on every exchange.
	if self != nil && string(self.Data) == string(encoded) {
		return records
	}
	data["updatedAt"] = now
	encoded, err = json.Marshal(data)
	if err != nil {
		return records
	}
	updated, err := store.Exchange(nil, []hostsync.Change{{
		Kind: hostsync.KindHost,
		ID:   s.serverID,
		Data: encoded,
	}})
	if err != nil {
		slog.Warn("host sync: could not add the relay route to this host's record", "err", err)
		return records
	}
	return updated
}
