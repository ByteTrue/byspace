package providers

// RewindCapabilities says which rewind modes a provider actually implements.
//
// The capability is a promise the client renders a button from. Declaring rewind everywhere makes the button
// appear for providers that cannot do it, and pressing it fails — which reads as the app being broken rather
// than the feature being unavailable.
//
// These values describe what THIS daemon implements, not what the provider could do in principle. omp still reports
// nothing: it rejects the `--extension` that Go's tree navigation lives in, so there is no way to move its leaf.
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
	case "opencode":
		// `session.revert` restores the conversation and the files the session changed.
		return RewindCapabilities{Conversation: true, Files: true}
	case "codex":
		// `thread/rollback` drops turns from the thread; the working tree is untouched.
		return RewindCapabilities{Conversation: true}
	case "claude":
		// The transcript is forked at the file level. Files are not restored: the SDK's `rewindFiles` reads checkpoints
		// that only its own query object can reach.
		return RewindCapabilities{Conversation: true}
	case "mock":
		// The scripted provider runs in-process, so both halves are real: conversation rewind truncates
		// its own timeline, and files rewind is the daemon's git discard against the agent's cwd.
		return RewindCapabilities{Conversation: true, Files: true}
	default:
		// Everything else: no rewind. Claiming it is worse than not offering it.
		return RewindCapabilities{}
	}
}

// SupportsRewindBoth reports the combined mode: it needs both halves, so it is only available when both are.
func (r RewindCapabilities) SupportsRewindBoth() bool {
	return r.Conversation && r.Files
}
