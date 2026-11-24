package proc

var queryProcessIdentity = queryProcessIdentityPlatform

// CaptureProcessIdentity records the root's start identity. An empty value is not trusted by
// shutdown: it means the process exited before capture or the platform query failed.
func CaptureProcessIdentity(pid int) string {
	identity, _, err := queryProcessIdentity(pid)
	if err != nil {
		return ""
	}
	return identity
}

func processIdentityMatches(pid int, identity string) bool {
	if identity == "" {
		return false
	}
	current, exists, err := queryProcessIdentity(pid)
	if err != nil {
		return false
	}
	// Only an authoritative absent-root result permits signaling the original group/descendants.
	// A live root must still have exactly the identity captured at spawn.
	return !exists || (current != "" && current == identity)
}
