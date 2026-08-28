//go:build windows

package privatepath

import (
	"errors"
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func SecureDirectory(path string) error {
	return setPrivateDACL(path, true)
}

func SecureFile(path string) error {
	return setPrivateDACL(path, false)
}

func setPrivateDACL(path string, directory bool) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return fmt.Errorf("get current Windows user: %w", err)
	}
	flags := ""
	if directory {
		flags = "OICI"
	}
	descriptor, err := windows.SecurityDescriptorFromString(fmt.Sprintf(
		"D:P(A;%s;FA;;;%s)(A;%s;FA;;;SY)", flags, user.User.Sid.String(), flags,
	))
	if err != nil {
		return fmt.Errorf("build private Windows DACL: %w", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read private Windows DACL: %w", err)
	}
	if err := windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		user.User.Sid,
		nil,
		dacl,
		nil,
	); err != nil {
		return fmt.Errorf("apply private Windows DACL: %w", err)
	}
	return nil
}

func ValidateDirectory(path string) (os.FileInfo, error) {
	return validate(path, true)
}

func ValidateFile(path string) (os.FileInfo, error) {
	return validate(path, false)
}

func validate(path string, directory bool) (os.FileInfo, error) {
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	attributes, err := windows.GetFileAttributes(pathPointer)
	if err != nil {
		return nil, err
	}
	if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return nil, errors.New("private path must not be a Windows reparse point")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if directory && !info.IsDir() {
		return nil, errors.New("private path is not a directory")
	}
	if !directory && !info.Mode().IsRegular() {
		return nil, errors.New("private path is not a regular file")
	}
	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return nil, fmt.Errorf("read Windows security descriptor: %w", err)
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, fmt.Errorf("get current Windows user: %w", err)
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil || !owner.Equals(user.User.Sid) {
		return nil, errors.New("private Windows path is not owned by the current user")
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return nil, errors.New("private Windows path DACL is not protected")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil {
		return nil, errors.New("private Windows path has no DACL")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return nil, fmt.Errorf("create Windows SYSTEM SID: %w", err)
	}
	currentUserAllowed := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return nil, fmt.Errorf("read Windows DACL entry: %w", err)
		}
		if ace == nil || ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return nil, errors.New("private Windows path has an unexpected DACL entry")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !sid.IsValid() || (!sid.Equals(user.User.Sid) && !sid.Equals(system)) {
			return nil, errors.New("private Windows path grants access to another principal")
		}
		if sid.Equals(user.User.Sid) {
			currentUserAllowed = true
		}
	}
	if !currentUserAllowed {
		return nil, errors.New("private Windows path does not grant access to the current user")
	}
	return info, nil
}
