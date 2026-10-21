package providers

// RewindCapabilities says which rewind modes a provider actually implements.
//
// The capability is a promise the client renders a button from. Declaring rewind everywhere makes the button
// appear for providers that cannot do it, and pressing it fails — which reads as the app being broken rather
// than the feature being unavailable.
//
// These values describe what THIS daemon implements, not what the provider could do in principle. Node's table
// differs in two places for that reason: it implements claude's `forkSession` and omp's tree navigation, and Go
// does not — claude's rewind needs the SDK's fork path and omp rejects pi's `--extension`, which is where Go's
// tree navigation lives.
type RewindCapabilities struct {
	Conversation bool
	// Files means the working tree is restored as well as the conversation.
	Files bool
}

// RewindCapabilitiesFor returns a provider's rewind support.
func RewindCapabilitiesFor(provider string) RewindCapabilities {
	switch provider {
	case "pi":
		// Conversation rewind goes through the integration extension's tree navigation, which is pi's
		// mechanism; files are not restored.
		return RewindCapabilities{Conversation: true}
	default:
		// Everything else: no rewind. Claiming it is worse than not offering it.
		return RewindCapabilities{}
	}
}

// SupportsRewindBoth reports the combined mode: it needs both halves, so it is only available when both are.
func (r RewindCapabilities) SupportsRewindBoth() bool {
	return r.Conversation && r.Files
}
