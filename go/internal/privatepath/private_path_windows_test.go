//go:build windows

package privatepath

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestPrivateWindowsPathsUseProtectedCurrentUserDACLs(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := SecureDirectory(directory); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateDirectory(directory); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(directory, "secret.json")
	if err := os.WriteFile(path, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SecureFile(path); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateFile(path); err != nil {
		t.Fatal(err)
	}

	worldDescriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	worldDACL, _, err := worldDescriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		worldDACL,
		nil,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateFile(path); err == nil {
		t.Fatal("world-readable Windows DACL was accepted")
	}
}
