package server

import "testing"

// A wildcard listen has no usable endpoint of its own, so the LAN address is used — otherwise the answer is always
// "localhost", which is the one address a phone cannot use.
func TestBuildOfferEndpoints(t *testing.T) {
	wildcard := BuildOfferEndpoints("0.0.0.0", 6778)
	// localhost is always last; a LAN address may or may not exist on the test machine.
	if wildcard[len(wildcard)-1] != "localhost:6778" {
		t.Fatalf("localhost is not last: %v", wildcard)
	}

	// A specific non-loopback address is used as given.
	specific := BuildOfferEndpoints("192.168.1.10", 6778)
	if len(specific) != 2 || specific[0] != "192.168.1.10:6778" {
		t.Fatalf("specific = %v", specific)
	}

	// A loopback listen adds nothing beyond localhost.
	for _, host := range []string{"127.0.0.1", "localhost", "::1"} {
		got := BuildOfferEndpoints(host, 6778)
		if len(got) != 1 || got[0] != "localhost:6778" {
			t.Fatalf("%q = %v", host, got)
		}
	}

	// The IPv6 wildcard spelling is recognised too.
	if got := BuildOfferEndpoints("[::]", 6778); got[len(got)-1] != "localhost:6778" {
		t.Fatalf("[::] = %v", got)
	}
}

func TestIsWildcardAndLoopback(t *testing.T) {
	for _, host := range []string{"0.0.0.0", "::", "[::]"} {
		if !IsWildcardListenHost(host) {
			t.Fatalf("%q should be wildcard", host)
		}
	}
	for _, host := range []string{"127.0.0.1", "localhost", "::1", "[::1]"} {
		if !IsLoopbackHost(host) {
			t.Fatalf("%q should be loopback", host)
		}
	}
	if IsWildcardListenHost("192.168.1.10") || IsLoopbackHost("192.168.1.10") {
		t.Fatal("a LAN address is neither")
	}
}

// A machine with no network still serves localhost; inventing an address would produce an endpoint that cannot
// connect.
func TestPrimaryLANIPIsEmptyOrValid(t *testing.T) {
	got := primaryLANIP()
	if got == "" {
		return // no network: the only endpoint is localhost, which is correct
	}
	if got == "127.0.0.1" || got == "::1" {
		t.Fatalf("a loopback address was chosen: %q", got)
	}
}

func TestDedupeStrings(t *testing.T) {
	got := dedupeStrings([]string{"a", "b", "a", "c", "b"})
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("got %v", got)
	}
}

func TestItoa(t *testing.T) {
	cases := map[int]string{0: "0", 1: "1", 9: "9", 10: "10", 6778: "6778", 65535: "65535"}
	for port, want := range cases {
		if got := itoa(port); got != want {
			t.Fatalf("%d → %q, want %q", port, got, want)
		}
	}
}
