package providers

import (
	"context"
	"fmt"
	"github.com/ByteTrue/byspace/internal/proc"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	openCodeVersionPattern = regexp.MustCompile(`^(?i:opencode[ ]+)?v?([0-9]+)[.]([0-9]+)[.]([0-9]+)([-+][A-Za-z0-9_.-]+)?$`)
	openCodeANSIPattern    = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
)

// openCodeMajorVersion selects the HTTP protocol for the installed binary. Unknown output retains
// the v1 behavior because legacy wrappers did not implement --version.
func openCodeMajorVersion(output string) (int, error) {
	output = openCodeANSIPattern.ReplaceAllString(output, "")
	match := openCodeVersionPattern.FindStringSubmatch(strings.TrimSpace(output))
	if match == nil {
		return 1, nil
	}
	major, _ := strconv.Atoi(match[1])
	minor, _ := strconv.Atoi(match[2])
	patch, _ := strconv.Atoi(match[3])
	switch major {
	case 1:
		return 1, nil
	case 2:
		if minor < 0 || (minor == 0 && patch < 10) {
			return 0, fmt.Errorf("OpenCode %d.%d.%d is too old for this BySpace integration. Update OpenCode to 2.0.10 or newer, then refresh the provider in BySpace.", major, minor, patch)
		}
		return 2, nil
	default:
		return 0, fmt.Errorf("Unsupported OpenCode major version %d; supported versions are 1 and 2", major)
	}
}

func probeOpenCodeBinaryVersion(ctx context.Context, command string, args []string, extraEnv map[string]string) (int, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	argv := append(append([]string{}, args...), "--version")
	cmd := proc.CommandContext(probeCtx, command, argv...)
	cmd.Env = os.Environ()
	for key, value := range extraEnv {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return 1, fmt.Errorf("opencode --version: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return openCodeMajorVersion(string(output))
}
