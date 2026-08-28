//go:build !unix && !windows

package relay

func syncIdentityDirectory(string) error { return nil }
