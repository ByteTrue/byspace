package server

import (
	"sort"
	"strings"

	"encoding/json"
)

// Config reload accounting, ported from daemon-config-store.ts.
//
// The client needs to tell the user which settings took effect and which need a restart. The
// daemon used to answer with three empty lists, so every change looked equally "not applied" —
// the settings page had nothing to report.

// reloadablePaths are the settings the daemon can pick up without restarting, keyed by their
// persisted path.
var reloadablePaths = []string{
	"daemon.relay.enabled",
	"daemon.relay.endpoint",
	"daemon.relay.useTls",
	"daemon.tunnel.enabled",
	"daemon.tunnel.allowedPorts",
	"daemon.mcp.enabled",
	"daemon.mcp.injectIntoAgents",
	"daemon.hostnames",
	"daemon.cors.allowedOrigins",
	"daemon.trustedProxies",
	"daemon.git.maxProcessesPerSecond",
	"daemon.git.maxProcessConcurrency",
	"daemon.autoArchiveAfterMerge",
	"daemon.enableTerminalAgentHooks",
	"daemon.terminalAgentHooks",
	"daemon.appendSystemPrompt",
	"daemon.terminalProfiles",
	"daemon.agentProfiles",
	"app.baseUrl",
	"agents.providers",
	"agents.catalogRefreshTimeoutMs",
	"agents.metadataGeneration",
	"agents.skills.selection",
	"agents.skills.targets",
	"pluginsEnabled",
}

// environmentOwnedPaths are settings an environment variable owns; editing config.json has no
// effect on them, and the UI must say so instead of silently ignoring the change.
var environmentOwnedPaths = map[string]string{
	"daemon.listen":                    "BYSPACE_LISTEN",
	"daemon.auth.password":             "BYSPACE_PASSWORD",
	"daemon.relay.endpoint":            "BYSPACE_RELAY_ENDPOINT",
	"daemon.cors.allowedOrigins":       "BYSPACE_CORS_ORIGINS",
	"daemon.hostnames":                 "BYSPACE_HOSTNAMES",
	"daemon.trustedProxies":            "BYSPACE_TRUSTED_PROXIES",
	"app.baseUrl":                      "BYSPACE_APP_BASE_URL",
	"daemon.git.maxProcessesPerSecond": "BYSPACE_GIT_MAX_PROCESSES_PER_SECOND",
	"daemon.git.maxProcessConcurrency": "BYSPACE_GIT_MAX_PROCESS_CONCURRENCY",
}

// pathBelongsTo reports whether a setting path is the owner path or sits underneath it.
func pathBelongsTo(path, owner string) bool {
	return path == owner || strings.HasPrefix(path, owner+".")
}

// configReloadReport splits the settings that differ between two config snapshots into
// "applied now", "needs restart", and "owned by the environment".
func configReloadReport(previous, next map[string]any, changedPaths []string) map[string]any {
	applied := make([]string, 0, len(changedPaths))
	restart := make([]string, 0, len(changedPaths))
	overridden := make([]string, 0, 4)

	for _, path := range changedPaths {
		owner := ""
		for ownedPath, env := range environmentOwnedPaths {
			if pathBelongsTo(path, ownedPath) {
				owner = env
				break
			}
		}
		if owner != "" {
			overridden = append(overridden, path)
			continue
		}
		reloadable := false
		for _, candidate := range reloadablePaths {
			if pathBelongsTo(path, candidate) {
				reloadable = true
				break
			}
		}
		if reloadable {
			applied = append(applied, path)
		} else {
			restart = append(restart, path)
		}
	}

	sort.Strings(applied)
	sort.Strings(restart)
	sort.Strings(overridden)
	return map[string]any{
		"appliedPaths":            applied,
		"restartRequiredPaths":    restart,
		"overrideControlledPaths": overridden,
	}
}

// flattenedConfigPaths lists every leaf path in a config map, e.g. `daemon.relay.enabled`.
func flattenedConfigPaths(cfg map[string]any, prefix string) map[string]any {
	out := make(map[string]any)
	var walk func(map[string]any, string)
	walk = func(node map[string]any, path string) {
		for key, value := range node {
			full := key
			if path != "" {
				full = path + "." + key
			}
			if child, ok := value.(map[string]any); ok {
				walk(child, full)
				continue
			}
			out[full] = value
		}
	}
	walk(cfg, prefix)
	return out
}

// diffConfigPaths returns the leaf paths whose values differ between two snapshots.
func diffConfigPaths(previous, next map[string]any) []string {
	prevFlat := flattenedConfigPaths(previous, "")
	nextFlat := flattenedConfigPaths(next, "")
	seen := make(map[string]bool, len(prevFlat)+len(nextFlat))
	changed := make([]string, 0, 8)
	for path, value := range nextFlat {
		seen[path] = true
		if !valuesEqual(prevFlat[path], value) {
			changed = append(changed, path)
		}
	}
	for path := range prevFlat {
		if !seen[path] {
			changed = append(changed, path)
		}
	}
	sort.Strings(changed)
	return changed
}

// valuesEqual compares two config leaves by their JSON form: config values are decoded into
// `any`, so ints, floats and strings can differ in Go type while being the same setting.
func valuesEqual(a, b any) bool {
	ab, aErr := json.Marshal(a)
	bb, bErr := json.Marshal(b)
	if aErr != nil || bErr != nil {
		return false
	}
	return string(ab) == string(bb)
}

// daemonConfigSnapshot is the persisted view used for diffing.
//
// The daemon stores settings flat (`relay`, `mcp`, `providers`…), while the wire and the node
// daemon speak dotted paths (`daemon.relay.enabled`, `agents.providers`). Mapping happens here
// so the diff compares user-facing paths.
func (s *Server) daemonConfigSnapshot() map[string]any {
	cfg := s.store.LoadDaemonConfig()
	snapshot := map[string]any{"daemon": map[string]any{}, "agents": map[string]any{}}
	daemon := snapshot["daemon"].(map[string]any)
	agents := snapshot["agents"].(map[string]any)

	for key, value := range cfg {
		switch key {
		case "providers", "metadataGeneration", "skills", "skillTargets", "catalogRefreshTimeoutMs":
			agents[key] = value
		case "pluginsEnabled":
			snapshot[key] = value
		case "appBaseUrl":
			snapshot["app"] = map[string]any{"baseUrl": value}
		case "corsOrigins":
			daemon["cors"] = map[string]any{"allowedOrigins": value}
		default:
			daemon[key] = value
		}
	}
	return snapshot
}
