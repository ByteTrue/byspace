//go:build !windows || (windows && !amd64 && !arm64)

package terminal

// ensureConptyRuntime is a no-op where the bundled ConPTY payload does not apply: Unix PTYs relay
// mouse modes natively, and unsupported Windows architectures keep the inbox implementation.
func ensureConptyRuntime() {}
