package daemon

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ByteTrue/byspace/internal/home"
)

// Login-service installation, ported from daemon-service-install.ts.
//
// `daemon start` runs the process now; a login service makes it survive a reboot. Writing the
// plist/unit file is only half of it — the platform has to be told to load it, and "installed"
// with an unloaded unit looks identical to "installed and working" until the next login.

// ServiceInstallResult reports what was registered.
type ServiceInstallResult struct {
	// DefinitionPath is the plist or unit file written.
	DefinitionPath string
	// Loaded reports whether the platform accepted the registration.
	Loaded bool
	// Note carries a platform-specific remark (already loaded, command unavailable).
	Note string
}

// InstallLoginService registers the daemon as a per-user login service.
//
// Idempotent: an existing registration is unloaded before the new definition is loaded, so
// re-running after an update picks up the new binary path.
func InstallLoginService(exe string, args, env []string, logFile string) (ServiceInstallResult, error) {
	switch runtime.GOOS {
	case "darwin":
		return installLaunchAgent(exe, args, env, logFile)
	case "linux":
		return installSystemdUserUnit(exe, args, env)
	default:
		return ServiceInstallResult{}, fmt.Errorf(
			"login services are not supported on %s; run `byspace daemon start` from your own init system", runtime.GOOS)
	}
}

// UninstallLoginService removes the registration and the definition file.
func UninstallLoginService() error {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		uid := os.Getuid()
		_ = exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", uid, LaunchdLabel)).Run()
		if removeErr := os.Remove(LaunchdPlistPath(userHome)); removeErr != nil && !os.IsNotExist(removeErr) {
			return removeErr
		}
		return nil
	case "linux":
		_ = exec.Command("systemctl", "--user", "disable", "--now", SystemdUnit+".service").Run()
		if removeErr := os.Remove(SystemdUnitPath(userHome)); removeErr != nil && !os.IsNotExist(removeErr) {
			return removeErr
		}
		_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
		return nil
	default:
		return fmt.Errorf("login services are not supported on %s", runtime.GOOS)
	}
}

// ServiceStatus reports whether the login service is registered and running.
//
// Two separate facts: a registered-but-stopped service means the user installed it and it
// crashed, which is a different problem from not having installed it.
type ServiceStatus struct {
	// Supported is false on platforms without a per-user service.
	Supported bool
	// Registered is whether the platform knows about the service.
	Registered bool
	// Running is whether the platform reports it as active.
	Running bool
	// Detail is the platform's own output, for a human.
	Detail string
}

// QueryServiceStatus asks the platform about the login service.
func QueryServiceStatus() ServiceStatus {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return ServiceStatus{}
	}
	switch runtime.GOOS {
	case "darwin":
		uid := os.Getuid()
		out, printErr := exec.Command("launchctl", "print", fmt.Sprintf("gui/%d/%s", uid, LaunchdLabel)).CombinedOutput()
		if printErr != nil {
			// Not registered. A plist on disk without a registration is the half-installed
			// state, which is worth distinguishing.
			if _, statErr := os.Stat(LaunchdPlistPath(userHome)); statErr == nil {
				return ServiceStatus{Supported: true, Registered: false, Detail: "definition file exists but is not loaded"}
			}
			return ServiceStatus{Supported: true, Registered: false, Detail: "not installed"}
		}
		text := string(out)
		return ServiceStatus{
			Supported:  true,
			Registered: true,
			// `launchctl print` reports the pid when the job is running.
			Running: strings.Contains(text, "pid = "),
			Detail:  firstLines(text, 3),
		}
	case "linux":
		if _, statErr := os.Stat(SystemdUnitPath(userHome)); statErr != nil {
			return ServiceStatus{Supported: true, Registered: false, Detail: "not installed"}
		}
		out, _ := exec.Command("systemctl", "--user", "is-active", SystemdUnit+".service").CombinedOutput()
		state := strings.TrimSpace(string(out))
		return ServiceStatus{
			Supported:  true,
			Registered: true,
			Running:    state == "active",
			Detail:     state,
		}
	default:
		return ServiceStatus{Supported: false, Detail: "not supported on " + runtime.GOOS}
	}
}

// installLaunchAgent writes the plist and bootstraps it into the user's launchd session.
func installLaunchAgent(exe string, args, env []string, logFile string) (ServiceInstallResult, error) {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return ServiceInstallResult{}, err
	}
	plistPath := LaunchdPlistPath(userHome)
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return ServiceInstallResult{}, err
	}
	plist := RenderLaunchdPlist(exe, args, env, logFile)
	if err := home.WriteAtomic(plistPath, []byte(plist), 0o644); err != nil {
		return ServiceInstallResult{}, err
	}

	uid := os.Getuid()
	// Unload first so a re-install picks up the new definition; bootout fails harmlessly when
	// nothing is loaded.
	_ = exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", uid, LaunchdLabel)).Run()
	boot := exec.Command("launchctl", "bootstrap", fmt.Sprintf("gui/%d", uid), plistPath)
	if output, bootErr := boot.CombinedOutput(); bootErr != nil {
		return ServiceInstallResult{
			DefinitionPath: plistPath,
			Loaded:         false,
			Note:           strings.TrimSpace(string(output)),
		}, nil
	}
	// The job is bootstrapped but not started; kickstart makes "install" mean "running now".
	_ = exec.Command("launchctl", "kickstart", "-k", fmt.Sprintf("gui/%d/%s", uid, LaunchdLabel)).Run()
	return ServiceInstallResult{DefinitionPath: plistPath, Loaded: true}, nil
}

// installSystemdUserUnit writes the unit and enables it.
func installSystemdUserUnit(exe string, args, env []string) (ServiceInstallResult, error) {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return ServiceInstallResult{}, err
	}
	unitPath := SystemdUnitPath(userHome)
	if err := os.MkdirAll(filepath.Dir(unitPath), 0o755); err != nil {
		return ServiceInstallResult{}, err
	}
	if err := home.WriteAtomic(unitPath, []byte(RenderSystemdUnit(exe, args, env)), 0o644); err != nil {
		return ServiceInstallResult{}, err
	}

	// A new unit file is invisible to systemd until it reloads.
	if output, reloadErr := exec.Command("systemctl", "--user", "daemon-reload").CombinedOutput(); reloadErr != nil {
		return ServiceInstallResult{
			DefinitionPath: unitPath,
			Loaded:         false,
			Note:           strings.TrimSpace(string(output)),
		}, nil
	}
	if output, enableErr := exec.Command("systemctl", "--user", "enable", "--now", SystemdUnit+".service").CombinedOutput(); enableErr != nil {
		return ServiceInstallResult{
			DefinitionPath: unitPath,
			Loaded:         false,
			Note:           strings.TrimSpace(string(output)),
		}, nil
	}
	return ServiceInstallResult{DefinitionPath: unitPath, Loaded: true}, nil
}

// firstLines returns at most n lines of text, for a status detail.
func firstLines(text string, n int) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, " / ")
}
