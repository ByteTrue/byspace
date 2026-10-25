// Package authz decides whether a connected principal may send or receive a message.
//
// Ported from server/authorization. Permissions are semantic ("workspace.write"), not RPC
// namespaces, so a new RPC inherits the right requirement by what it does rather than by where
// its name starts. An operation with no permission requirement is allowed to everyone; those are
// the read-only and liveness messages a client needs in order to render anything at all.
package authz

// DaemonPermissions are the permissions a principal can hold.
//
// Mirrors DAEMON_PERMISSIONS in the protocol. A value outside this list is a bug in whatever
// granted it, not a name to accept.
var DaemonPermissions = []string{
	"daemon.read",
	"daemon.manage",
	"tunnel.manage",
	"access.manage",
	"workspace.read",
	"workspace.write",
	"workspace.manage",
	"automation.manage",
	"hub.execute",
}

var daemonPermissionSet = func() map[string]bool {
	set := make(map[string]bool, len(DaemonPermissions))
	for _, p := range DaemonPermissions {
		set[p] = true
	}
	return set
}()

// IsDaemonPermission reports whether a value names a real permission.
func IsDaemonPermission(value string) bool { return daemonPermissionSet[value] }

// ParsePermissions validates and deduplicates a permission list.
//
// Rejecting unknown values is the point: silently ignoring one would grant authority the writer
// did not intend, or deny it while looking like it was granted.
func ParsePermissions(values []string) ([]string, error) {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if !IsDaemonPermission(value) {
			return nil, errInvalidPermission(value)
		}
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out, nil
}

// OwnerPermissions is the full set: the local user owns the daemon.
func OwnerPermissions() []string {
	out := make([]string, len(DaemonPermissions))
	copy(out, DaemonPermissions)
	return out
}

// Authorization answers whether a principal holding Permissions may act.
type Authorization struct {
	permissions map[string]bool
}

// New builds an authorization for a permission set.
func New(permissions []string) *Authorization {
	set := make(map[string]bool, len(permissions))
	for _, p := range permissions {
		set[p] = true
	}
	return &Authorization{permissions: set}
}

// NewOwner grants everything, for the local connection.
func NewOwner() *Authorization { return New(DaemonPermissions) }

// AllowsInbound reports whether a request type may be sent.
func (a *Authorization) AllowsInbound(messageType string) bool {
	return a.allows(InboundPermission[messageType], InboundUnrestricted[messageType])
}

// AllowsOutbound reports whether a message type may be delivered.
func (a *Authorization) AllowsOutbound(messageType string) bool {
	return a.allows(OutboundPermission[messageType], OutboundUnrestricted[messageType])
}

// List returns the permissions held, in protocol order.
func (a *Authorization) List() []string {
	out := make([]string, 0, len(a.permissions))
	for _, p := range DaemonPermissions {
		if a.permissions[p] {
			out = append(out, p)
		}
	}
	return out
}

// Has reports whether one permission is held.
func (a *Authorization) Has(permission string) bool { return a.permissions[permission] }

// allows applies a requirement: any one of the listed permissions is sufficient, and an
// operation with neither a requirement nor an explicit "unrestricted" entry is denied.
//
// Denying unknown operations is deliberate. The table is generated from the Node source; a
// message type missing from it is either a new RPC that has not been classified or a typo, and
// defaulting to "allowed" would turn either into an open door.
func (a *Authorization) allows(requirements []string, unrestricted bool) bool {
	if unrestricted {
		return true
	}
	if len(requirements) == 0 {
		return false
	}
	for _, required := range requirements {
		if a.permissions[required] {
			return true
		}
	}
	return false
}
