package gui

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFindInstalledPWAMacMatchesBrowserWebAppAndIgnoresNativeBundle(t *testing.T) {
	userHome := t.TempDir()

	// 1. A native BySpace.app bundle placed in ~/Applications must NOT be mistaken for a PWA.
	nativePlist := filepath.Join(userHome, "Applications", "BySpace.app", "Contents", "Info.plist")
	if err := os.MkdirAll(filepath.Dir(nativePlist), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nativePlist, []byte(`<plist><dict><key>CFBundleIdentifier</key><string>com.bytetrue.byspace</string></dict></plist>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindInstalledPWAMac(userHome); got != "" {
		t.Fatalf("native bundle matched as PWA: %q", got)
	}

	// 2. A Chrome-installed Web App bundle in ~/Applications/Chrome Apps.localized/BySpace.app is detected.
	chromeApp := filepath.Join(userHome, "Applications", "Chrome Apps.localized", "BySpace.app")
	chromePlist := filepath.Join(chromeApp, "Contents", "Info.plist")
	if err := os.MkdirAll(filepath.Dir(chromePlist), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(chromePlist, []byte(`<plist><dict><key>CFBundleIdentifier</key><string>com.google.Chrome.app.abcdef</string><key>CrAppModeShortcutName</key><string>BySpace</string></dict></plist>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindInstalledPWAMac(userHome); got != chromeApp {
		t.Fatalf("FindInstalledPWAMac = %q, want %q", got, chromeApp)
	}
}

func TestFindInstalledPWAWindowsRequiresAppIDFlag(t *testing.T) {
	appData := t.TempDir()
	programs := filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs")
	if err := os.MkdirAll(filepath.Join(programs, "Chrome Apps"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Plain shortcut to byspace.exe without --app-id= is ignored.
	plainLnk := filepath.Join(programs, "BySpace.lnk")
	if err := os.WriteFile(plainLnk, []byte(`C:\Users\me\AppData\Local\BySpace\byspace.exe`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindInstalledPWAWindows(appData); got != "" {
		t.Fatalf("plain shortcut matched as PWA: %q", got)
	}

	// 2. UTF-16LE --app-id= inside Chrome Apps\BySpace.lnk is detected.
	pwaLnk := filepath.Join(programs, "Chrome Apps", "BySpace.lnk")
	payload := append([]byte("LNK-HEADER"), asciiToUTF16LE(`--profile-directory=Default --app-id=ockbphcelebgabjeeemkbkeifbbjbfep`)...)
	if err := os.WriteFile(pwaLnk, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := FindInstalledPWAWindows(appData); got != pwaLnk {
		t.Fatalf("FindInstalledPWAWindows = %q, want %q", got, pwaLnk)
	}
}

func TestFindInstalledPWALinuxParsesDesktopEntry(t *testing.T) {
	userHome := t.TempDir()
	appsDir := filepath.Join(userHome, ".local", "share", "applications")
	if err := os.MkdirAll(appsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	desktopFile := filepath.Join(appsDir, "chrome-ockbphcelebgabjeeemkbkeifbbjbfep-Default.desktop")
	body := "[Desktop Entry]\nVersion=1.0\nTerminal=false\nType=Application\nName=BySpace\nExec=\"/opt/google/chrome/google-chrome\" --profile-directory=Default --app-id=ockbphcelebgabjeeemkbkeifbbjbfep %U\n"
	if err := os.WriteFile(desktopFile, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	got := FindInstalledPWALinux(userHome)
	want := []string{"/opt/google/chrome/google-chrome", "--profile-directory=Default", "--app-id=ockbphcelebgabjeeemkbkeifbbjbfep"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FindInstalledPWALinux = %#v, want %#v", got, want)
	}
}

func TestBuildLocalWebURL(t *testing.T) {
	if got := BuildLocalWebURL("127.0.0.1:6777", ""); got != "http://127.0.0.1:6777/" {
		t.Fatalf("got %q, want http://127.0.0.1:6777/", got)
	}
	if got := BuildLocalWebURL("127.0.0.1:6777", "byspace://#offer=abc"); got != "http://127.0.0.1:6777/#offer=abc" {
		t.Fatalf("got %q, want http://127.0.0.1:6777/#offer=abc", got)
	}
}
