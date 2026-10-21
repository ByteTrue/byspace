package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ByteTrue/byspace/internal/store"

	"github.com/ByteTrue/byspace/internal/serviceproxy"
)

// serviceProxyProxy returns the reverse proxy for workspace services, creating it on first use.
//
// Created lazily: a daemon with no `type: "service"` scripts should not start a listener, and the
// base domain comes from config which is not available at construction time.
func (s *Server) serviceProxy() *serviceproxy.Proxy {
	s.mu.Lock()
	if s.serviceProxyRoutes != nil {
		proxy := s.serviceProxyRoutes
		s.mu.Unlock()
		return proxy
	}
	baseDomain := s.serviceProxyBaseDomain()
	proxy := serviceproxy.NewProxy(baseDomain, func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, "service-proxy: "+format+"\n", args...)
	})
	s.serviceProxyRoutes = proxy
	s.mu.Unlock()
	return proxy
}

// serviceProxyBaseDomain reads the public base domain from config.
//
// Empty means only `.localhost` hostnames are served, which is the correct default for a daemon
// that is not published: a public hostname without DNS behind it resolves nowhere.
func (s *Server) serviceProxyBaseDomain() string {
	config := s.store.LoadDaemonConfig()
	if config == nil {
		return ""
	}
	raw, ok := config["serviceProxy"].(map[string]any)
	if !ok {
		return ""
	}
	domain, _ := raw["baseDomain"].(string)
	return strings.TrimSpace(domain)
}

// registerServiceRoute exposes a running service script at its hostname.
//
// Called when a `type: "service"` script starts. A `type: "script"` gets no route: it is a
// one-shot command, and registering its port would expose something that is already gone.
func (s *Server) registerServiceRoute(workspaceID, scriptName string, port int) {
	if port <= 0 {
		return
	}
	record := s.findWorkspaceRecord(workspaceID)
	if record == nil {
		return
	}
	projectSlug := record.DisplayName
	if strings.TrimSpace(projectSlug) == "" {
		projectSlug = filepath.Base(record.Cwd)
	}
	identity := serviceproxy.ServiceIdentity{
		ProjectSlug: projectSlug,
		BranchName:  record.Branch,
		ScriptName:  scriptName,
	}
	hostname := serviceproxy.BuildLocalHostname(identity)

	s.serviceProxy().Register(serviceproxy.Route{
		Hostname:    hostname,
		Port:        port,
		WorkspaceID: workspaceID,
		ScriptName:  scriptName,
	})
}

// unregisterServiceRoute removes a stopped script's route.
//
// A stale route forwards to a port that may now belong to another workspace, which is worse than a
// 404 — the user would see someone else's app under their own URL.
func (s *Server) unregisterServiceRoute(workspaceID, scriptName string) {
	s.mu.Lock()
	proxy := s.serviceProxyRoutes
	s.mu.Unlock()
	if proxy == nil {
		return
	}
	proxy.UnregisterScript(workspaceID, scriptName)
}

// serviceProxyHostnameFor reports the hostname a script is reachable at, for the script payload.
//
// Computed from the same inputs the route used, so the URL the client shows and the route the
// proxy serves cannot drift.
func (s *Server) serviceProxyHostnameFor(workspaceID, scriptName string) string {
	record := s.findWorkspaceRecord(workspaceID)
	if record == nil {
		return ""
	}
	projectSlug := record.DisplayName
	if strings.TrimSpace(projectSlug) == "" {
		projectSlug = filepath.Base(record.Cwd)
	}
	return serviceproxy.BuildLocalHostname(serviceproxy.ServiceIdentity{
		ProjectSlug: projectSlug,
		BranchName:  record.Branch,
		ScriptName:  scriptName,
	})
}

// serviceProxyURLFor returns the browsable URL for a script.
func (s *Server) serviceProxyURLFor(workspaceID, scriptName string, port int) string {
	if port <= 0 {
		return ""
	}
	hostname := s.serviceProxyHostnameFor(workspaceID, scriptName)
	if hostname == "" {
		return ""
	}
	// The daemon's own port, because the proxy shares the daemon listener for `.localhost`
	// hostnames — a second port would need a second certificate and a second CORS origin.
	// Plain http on the daemon's own port: the proxy shares the daemon listener for `.localhost`
	// hostnames, so a second port would need a second certificate and a second CORS origin.
	return "http://" + hostname + portSuffix(s.listenAddr)
}

// portSuffix extracts `:port` from a listen address.
func portSuffix(listenAddr string) string {
	index := strings.LastIndex(listenAddr, ":")
	if index < 0 {
		return ""
	}
	return listenAddr[index:]
}

// findWorkspaceRecord looks a workspace up by id.
func (s *Server) findWorkspaceRecord(workspaceID string) *store.WorkspaceRecord {
	records, err := s.store.ListWorkspaces()
	if err != nil {
		return nil
	}
	for index := range records {
		if records[index].WorkspaceID == workspaceID {
			return &records[index]
		}
	}
	return nil
}
