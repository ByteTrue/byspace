package server

import (
	"net"
	"os"
	"strings"
)

// BuildOfferEndpoints lists the addresses a client can reach this daemon at.
//
// Ported from connection-offer.ts. Go builds a relay offer only, so nothing called this — but the list is what tells a
// user on a phone which address to try when the daemon is listening on the wildcard address, and without it the answer
// is always "localhost", which is the one address a phone cannot use.
//
// The rules:
//   - A wildcard listen address has no usable endpoint of its own, so the machine's primary LAN address is used.
//   - A specific non-loopback address is used as given.
//   - A loopback listen adds nothing, since `localhost` covers it.
//   - `localhost:port` is always listed last, as the fallback for a client on the same machine.
func BuildOfferEndpoints(listenHost string, port int) []string {
	endpoints := make([]string, 0, 3)
	host := strings.TrimSpace(listenHost)
	portText := itoa(port)

	if IsWildcardListenHost(host) {
		if lanIP := primaryLANIP(); lanIP != "" {
			endpoints = append(endpoints, lanIP+":"+portText)
		}
	} else if !IsLoopbackHost(host) && host != "" {
		endpoints = append(endpoints, host+":"+portText)
	}

	endpoints = append(endpoints, "localhost:"+portText)
	return dedupeStrings(endpoints)
}

// IsWildcardListenHost reports whether a listen address means "every interface".
func IsWildcardListenHost(host string) bool {
	switch strings.TrimSpace(host) {
	case "0.0.0.0", "::", "[::]":
		return true
	}
	return false
}

// IsLoopbackHost reports whether a listen address is the loopback interface.
func IsLoopbackHost(host string) bool {
	trimmed := strings.Trim(strings.TrimSpace(host), "[]")
	switch trimmed {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	return false
}

// primaryLANIP returns the first non-loopback IPv4 address of an up interface.
//
// IPv4 first because the address is offered to a phone on the same network, and a link-local IPv6 address is not
// reachable without a scope id. Returns "" when there is no such address — a machine with no network still serves
// localhost, and inventing an address would produce an endpoint that cannot connect.
func primaryLANIP() string {
	// The override exists because "the primary LAN address" is a guess: a machine with a VPN, a
	// container bridge or several NICs can enumerate them in an order where the right one is not
	// first, and the pairing offer is useless when it names an address the phone cannot reach.
	if override := strings.TrimSpace(os.Getenv("BYSPACE_PRIMARY_LAN_IP")); override != "" {
		return override
	}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, address := range addresses {
		network, ok := address.(*net.IPNet)
		if !ok {
			continue
		}
		ip := network.IP
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			continue
		}
		if ip.To4() != nil {
			return ip.String()
		}
	}
	return ""
}

// dedupeStrings removes duplicates, keeping the first occurrence.
func dedupeStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

// itoa renders a port.
func itoa(port int) string {
	if port <= 0 {
		return "0"
	}
	var digits [8]byte
	index := len(digits)
	for port > 0 {
		index--
		digits[index] = byte('0' + port%10)
		port /= 10
	}
	return string(digits[index:])
}
