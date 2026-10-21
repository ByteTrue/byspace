package quota

import "context"

// All returns every registered fetcher.
//
// Providers whose credential is absent answer "unavailable" rather than being omitted: the page
// lists what this build can read, so the user can see whether a missing row means "not
// configured" or "not supported".
func All() []Fetcher {
	return []Fetcher{
		Codex{},
		Zai{},
	}
}

// FetchAll collects usage for every fetcher, in registration order.
//
// Sequential, not concurrent: each call is bounded by the HTTP timeout, and a settings page load
// is not worth opening one connection per provider.
func FetchAll(ctx context.Context) []Usage {
	out := make([]Usage, 0, len(All()))
	for _, f := range All() {
		out = append(out, f.FetchUsage(ctx))
	}
	return out
}
