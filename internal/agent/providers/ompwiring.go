package providers

import "github.com/ByteTrue/byspace/internal/agent/pi"

// init installs omp's tool-name unwrapper into the JSONL engine.
//
// The engine is shared with pi, and only omp wraps calls in `xdev`; installing it here keeps the engine free
// of provider-specific knowledge while still resolving the name before the detail is built.
func init() {
	pi.SetWrappedToolNameResolver(ResolveOmpToolCallName)
}
