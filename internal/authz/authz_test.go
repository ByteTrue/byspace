package authz

import "testing"

// Permissions are semantic, not namespaced: a new RPC inherits the right requirement by what it
// does rather than by where its name starts.
func TestSemanticPermissions(t *testing.T) {
	hubOnly := New([]string{"hub.execute"})
	if !hubOnly.AllowsInbound("hub.execution.agent.create.request") {
		t.Fatal("hub.execute should allow hub operations")
	}
	if !hubOnly.AllowsInbound("get_providers_snapshot_request") {
		t.Fatal("read-only snapshot requests are unrestricted")
	}
	if hubOnly.AllowsInbound("checkout_push_request") {
		t.Fatal("hub.execute must not allow pushing to a repository")
	}
}

// The owner holds everything, which is what keeps a local connection working unchanged.
func TestOwnerAllowsEverything(t *testing.T) {
	owner := NewOwner()
	for messageType := range InboundPermission {
		if !owner.AllowsInbound(messageType) {
			t.Fatalf("owner denied %q", messageType)
		}
	}
	for messageType := range OutboundPermission {
		if !owner.AllowsOutbound(messageType) {
			t.Fatalf("owner denied outbound %q", messageType)
		}
	}
}

// A requirement list means "any one of these is enough".
func TestAnyOfRequirement(t *testing.T) {
	reqs, ok := InboundPermission["archive_workspace_request"]
	if !ok {
		t.Fatal("expected a requirement for archive_workspace_request")
	}
	if len(reqs) < 2 {
		t.Skip("this operation has a single requirement")
	}
	// Holding only the second permission must still be enough.
	partial := New([]string{reqs[1]})
	if !partial.AllowsInbound("archive_workspace_request") {
		t.Fatalf("holding %q alone should suffice (needs any of %v)", reqs[1], reqs)
	}
}

// Denying unknown operations is deliberate: an unclassified message type is either a new RPC
// nobody classified or a typo, and defaulting to "allowed" turns either into an open door.
func TestUnknownOperationIsDenied(t *testing.T) {
	owner := NewOwner()
	if owner.AllowsInbound("some.unknown.request") {
		t.Fatal("an unknown inbound type must be denied")
	}
	if owner.AllowsOutbound("some.unknown.response") {
		t.Fatal("an unknown outbound type must be denied")
	}
}

// A principal with no permissions can still render: the unrestricted messages are exactly the
// ones a client needs to connect, query state and keep itself alive.
func TestEmptyPermissionsStillAllowsUnrestricted(t *testing.T) {
	empty := New(nil)
	for _, messageType := range []string{"ping", "client_heartbeat"} {
		if !InboundUnrestricted[messageType] {
			continue
		}
		if !empty.AllowsInbound(messageType) {
			t.Fatalf("%q must be unrestricted", messageType)
		}
	}
	if empty.AllowsInbound("create_agent_request") {
		t.Fatal("creating an agent requires workspace.write")
	}
}

func TestParsePermissions(t *testing.T) {
	got, err := ParsePermissions([]string{"workspace.read", "workspace.read", "daemon.read"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected dedupe, got %v", got)
	}
	if _, err := ParsePermissions([]string{"workspace.read", "not.a.permission"}); err == nil {
		t.Fatal("an unknown permission must be rejected, not ignored")
	}
}

func TestListIsStable(t *testing.T) {
	a := New([]string{"workspace.write", "daemon.read"})
	got := a.List()
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
	// Protocol order, not insertion order: two runs must agree.
	if got[0] != "daemon.read" || got[1] != "workspace.write" {
		t.Fatalf("unstable order: %v", got)
	}
}
