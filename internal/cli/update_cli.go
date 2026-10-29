package cli

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/ByteTrue/byspace/internal/selfupdate"
)

// shouldDispatchAgentUpdate reports whether `byspace update ...` was invoked with agent-update
// arguments (an agent ID or --model/--thinking flags) rather than the Magpie-style self-update.
func shouldDispatchAgentUpdate(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--proxy" || a == "--mirror" {
			i++
			continue
		}
		if strings.HasPrefix(a, "--proxy=") || strings.HasPrefix(a, "--mirror=") {
			continue
		}
		if a == "check" || a == "-h" || a == "--help" {
			return false
		}
		if strings.HasPrefix(a, "--model") || strings.HasPrefix(a, "--thinking") || strings.HasPrefix(a, "--addr") {
			return true
		}
		if !strings.HasPrefix(a, "-") {
			return true
		}
	}
	return false
}

func parseSelfUpdateFlags(args []string) (checkOnly bool, proxy, mirror string, err error) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "check" {
			checkOnly = true
			continue
		}
		name, val, eq := strings.Cut(a, "=")
		if name != "--proxy" && name != "--mirror" {
			return false, "", "", fmt.Errorf("usage: byspace update [check] [--proxy <url>] [--mirror <prefix>]")
		}
		if !eq {
			if i+1 >= len(args) {
				return false, "", "", fmt.Errorf("%s needs a value", name)
			}
			i++
			val = args[i]
		}
		if name == "--proxy" {
			if err := selfupdate.CheckProxy(val); err != nil {
				return false, "", "", err
			}
			proxy = val
			continue
		}
		if val != "off" && val != "direct" {
			if err := selfupdate.CheckMirror(val); err != nil {
				return false, "", "", err
			}
		}
		mirror = val
	}
	return checkOnly, proxy, mirror, nil
}

// runSelfUpdateCmd implements `byspace update [check] [--proxy <url>] [--mirror <prefix>]`,
// modeled after magpie's updateCmd: replaces the enclosing BySpace.app bundle on macOS when run
// from inside (or via symlink to) the app, or atomically replaces the standalone binary.
func runSelfUpdateCmd(currentVersion string, args []string, stdout io.Writer) error {
	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help") {
		fmt.Fprintln(stdout, "usage: byspace update [check] [--proxy <url>] [--mirror <prefix>]")
		return nil
	}
	checkOnly, proxy, mirror, err := parseSelfUpdateFlags(args)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	ctx = selfupdate.WithMirror(selfupdate.WithProxy(ctx, proxy), mirror)

	rel, err := selfupdate.Latest(ctx)
	if err != nil {
		return err
	}

	if !selfupdate.Newer(rel.Version, currentVersion) {
		if selfupdate.Released(currentVersion) {
			fmt.Fprintf(stdout, "✓ byspace %s is the latest\n", currentVersion)
		} else {
			fmt.Fprintf(stdout, "byspace %s was built from source; the latest release is %s\n", currentVersion, rel.Version)
		}
		return nil
	}

	fmt.Fprintf(stdout, "byspace %s is available (you have %s) · %s\n", rel.Version, currentVersion, rel.URL)
	if checkOnly {
		return nil
	}
	if !selfupdate.Released(currentVersion) {
		return fmt.Errorf("this byspace (%s) was built from source; install a release build to self-update", currentVersion)
	}

	via := ""
	if m := selfupdate.Mirror(ctx); m != "" {
		via = " through " + m
	}

	if appBundle := selfupdate.Bundle(); appBundle != "" {
		if !selfupdate.Writable(filepath.Dir(appBundle)) {
			return fmt.Errorf("cannot update %s: %s is not writable", appBundle, filepath.Dir(appBundle))
		}
		fmt.Fprintf(stdout, "  downloading %s%s …\n", selfupdate.AppAsset(), via)
		staged, stageErr := selfupdate.StageApp(ctx, rel, appBundle)
		if stageErr != nil {
			return stageErr
		}
		if installErr := selfupdate.InstallApp(staged, appBundle); installErr != nil {
			return installErr
		}
		fmt.Fprintf(stdout, "✓ updated %s to %s · quit and reopen BySpace to use it\n", appBundle, rel.Version)
		if copied := selfupdate.CopiedCLI(); copied != "" {
			binInApp := filepath.Join(appBundle, "Contents", "MacOS", "byspace")
			fmt.Fprintf(stdout, "  note: %s is a standalone copy; link it to follow app updates: ln -sf %s %s\n", copied, binInApp, copied)
		}
		return nil
	}

	exe, err := selfupdate.Executable()
	if err != nil {
		return err
	}
	if !selfupdate.Writable(filepath.Dir(exe)) {
		return fmt.Errorf("cannot update %s: %s is not writable", exe, filepath.Dir(exe))
	}

	assetName, _, err := selfupdate.ResolveBinaryAsset(rel)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "  downloading %s%s …\n", assetName, via)
	staged, err := selfupdate.StageBinary(ctx, rel, exe)
	if err != nil {
		return err
	}
	if err := selfupdate.InstallBinary(staged, exe); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "✓ updated to %s\n", rel.Version)
	return nil
}
