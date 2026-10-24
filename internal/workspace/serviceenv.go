package workspace

import (
	"fmt"
	"net"
	"regexp"
	"sort"
	"strings"
)

// Service environment for workspace scripts, ported from workspace-service-env.ts.
//
// A workspace usually runs more than one script — a frontend and an API, say — and they need to
// find each other's ports. Without this, a dev server has to hardcode the port its sibling
// happens to get, which breaks as soon as two workspaces run at once.

// ServicePeer is one running script and the port it owns.
type ServicePeer struct {
	ScriptName string
	Port       int
}

var serviceEnvDisallowed = regexp.MustCompile(`[^A-Z0-9]+`)

// NormalizeServiceEnvName turns a script name into an env-var segment.
//
// `web-app` and `web app` both become `WEB_APP`, which is why collisions must be checked: two
// scripts mapping to the same name would silently shadow each other's port.
func NormalizeServiceEnvName(scriptName string) string {
	upper := strings.ToUpper(scriptName)
	upper = serviceEnvDisallowed.ReplaceAllString(upper, "_")
	return strings.Trim(upper, "_")
}

// AssertNoServiceEnvNameCollisions fails when two scripts map to the same env name.
func AssertNoServiceEnvNameCollisions(scriptNames []string) error {
	byEnvName := make(map[string][]string, len(scriptNames))
	for _, name := range scriptNames {
		envName := NormalizeServiceEnvName(name)
		byEnvName[envName] = append(byEnvName[envName], name)
	}

	// Sorted so the message is stable across runs.
	envNames := make([]string, 0, len(byEnvName))
	for envName := range byEnvName {
		envNames = append(envNames, envName)
	}
	sort.Strings(envNames)

	var collisions []string
	for _, envName := range envNames {
		names := byEnvName[envName]
		if len(names) > 1 {
			sort.Strings(names)
			collisions = append(collisions, fmt.Sprintf("service env name collision for %s: %s",
				envName, strings.Join(names, ", ")))
		}
	}
	if len(collisions) > 0 {
		return fmt.Errorf("%s", strings.Join(collisions, "; "))
	}
	return nil
}

// ResolveServiceBindHost picks the address a script should listen on.
//
// A daemon bound to loopback must keep its scripts on loopback too: binding 0.0.0.0 would expose
// a dev server to the network just because the user opened BySpace.
func ResolveServiceBindHost(daemonListenHost string) string {
	host := strings.TrimSpace(daemonListenHost)
	if host == "" {
		return "127.0.0.1"
	}
	// Strip a port if the caller passed addr:port.
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	trimmed := strings.Trim(host, "[]")
	if trimmed == "" || trimmed == "localhost" {
		return "127.0.0.1"
	}
	if ip := net.ParseIP(trimmed); ip != nil && ip.IsLoopback() {
		return "127.0.0.1"
	}
	if strings.HasPrefix(trimmed, "127.") {
		return "127.0.0.1"
	}
	return "0.0.0.0"
}

// BuildServiceEnv produces the environment a service script runs with.
//
// Only port discovery is implemented; the proxy URLs Node also injects belong to the
// service-proxy subsystem, which this build does not have. Emitting a URL that goes nowhere
// would be worse than omitting it, so BYSPACE_URL / BYSPACE_SERVICE_*_URL are absent until the
// proxy exists (tracked in the service-proxy issue).
func BuildServiceEnv(scriptName string, daemonListenHost string, peers []ServicePeer) (map[string]string, error) {
	names := make([]string, 0, len(peers))
	for _, peer := range peers {
		names = append(names, peer.ScriptName)
	}
	if err := AssertNoServiceEnvNameCollisions(names); err != nil {
		return nil, err
	}

	self, ok := findPeer(peers, scriptName)
	if !ok {
		return nil, fmt.Errorf("service %q is missing from workspace service peers", scriptName)
	}

	env := map[string]string{
		"HOST":         ResolveServiceBindHost(daemonListenHost),
		"BYSPACE_PORT": fmt.Sprintf("%d", self.Port),
	}
	for _, peer := range peers {
		env[fmt.Sprintf("BYSPACE_SERVICE_%s_PORT", NormalizeServiceEnvName(peer.ScriptName))] = fmt.Sprintf("%d", peer.Port)
	}
	return env, nil
}

func findPeer(peers []ServicePeer, name string) (ServicePeer, bool) {
	for _, peer := range peers {
		if peer.ScriptName == name {
			return peer, true
		}
	}
	return ServicePeer{}, false
}
