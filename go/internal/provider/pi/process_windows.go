//go:build windows

package pi

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000
	processSetQuota                   = 0x0100
	processTerminate                  = 0x0001
	createSuspended                   = 0x00000004
	threadSnapshot                    = 0x00000004
	threadSuspendResume               = 0x0002
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	createJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	setInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	assignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	terminateJobObject       = kernel32.NewProc("TerminateJobObject")
	createToolhelp32Snapshot = kernel32.NewProc("CreateToolhelp32Snapshot")
	thread32First            = kernel32.NewProc("Thread32First")
	thread32Next             = kernel32.NewProc("Thread32Next")
	openThread               = kernel32.NewProc("OpenThread")
	resumeThread             = kernel32.NewProc("ResumeThread")
)

type jobBasicLimitInformation struct {
	perProcessUserTimeLimit int64
	perJobUserTimeLimit     int64
	limitFlags              uint32
	minimumWorkingSetSize   uintptr
	maximumWorkingSetSize   uintptr
	activeProcessLimit      uint32
	affinity                uintptr
	priorityClass           uint32
	schedulingClass         uint32
}

type jobIOCounters struct {
	readOperationCount  uint64
	writeOperationCount uint64
	otherOperationCount uint64
	readTransferCount   uint64
	writeTransferCount  uint64
	otherTransferCount  uint64
}

type jobExtendedLimitInformation struct {
	basicLimitInformation jobBasicLimitInformation
	ioInfo                jobIOCounters
	processMemoryLimit    uintptr
	jobMemoryLimit        uintptr
	peakProcessMemoryUsed uintptr
	peakJobMemoryUsed     uintptr
}

type threadEntry32 struct {
	size           uint32
	usageCount     uint32
	threadID       uint32
	ownerProcessID uint32
	basePriority   int32
	deltaPriority  int32
	flags          uint32
}

type processTree struct {
	mu     sync.Mutex
	handle syscall.Handle
}

func configureProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createSuspended}
}

func attachProcessTree(command *exec.Cmd) (*processTree, error) {
	handle, _, callErr := createJobObjectW.Call(0, 0)
	if handle == 0 {
		return nil, windowsCallError("CreateJobObjectW", callErr)
	}
	tree := &processTree{handle: syscall.Handle(handle)}
	information := jobExtendedLimitInformation{}
	information.basicLimitInformation.limitFlags = jobObjectLimitKillOnJobClose
	result, _, callErr := setInformationJobObject.Call(
		handle,
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&information)),
		unsafe.Sizeof(information),
	)
	if result == 0 {
		_ = tree.close()
		return nil, windowsCallError("SetInformationJobObject", callErr)
	}

	processHandle, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(command.Process.Pid))
	if err != nil {
		_ = tree.close()
		return nil, fmt.Errorf("open Pi process for job assignment: %w", err)
	}
	defer syscall.CloseHandle(processHandle)
	result, _, callErr = assignProcessToJobObject.Call(handle, uintptr(processHandle))
	if result == 0 {
		_ = tree.close()
		return nil, windowsCallError("AssignProcessToJobObject", callErr)
	}
	if err := resumeProcess(uint32(command.Process.Pid)); err != nil {
		_ = tree.close()
		return nil, err
	}
	return tree, nil
}

func resumeProcess(pid uint32) error {
	snapshot, _, callErr := createToolhelp32Snapshot.Call(threadSnapshot, 0)
	if snapshot == ^uintptr(0) {
		return windowsCallError("CreateToolhelp32Snapshot", callErr)
	}
	defer syscall.CloseHandle(syscall.Handle(snapshot))

	entry := threadEntry32{size: uint32(unsafe.Sizeof(threadEntry32{}))}
	result, _, callErr := thread32First.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	for result != 0 {
		if entry.ownerProcessID == pid {
			thread, _, openErr := openThread.Call(threadSuspendResume, 0, uintptr(entry.threadID))
			if thread == 0 {
				return windowsCallError("OpenThread", openErr)
			}
			resumeResult, _, resumeErr := resumeThread.Call(thread)
			_ = syscall.CloseHandle(syscall.Handle(thread))
			if resumeResult == ^uintptr(0) {
				return windowsCallError("ResumeThread", resumeErr)
			}
			return nil
		}
		entry.size = uint32(unsafe.Sizeof(threadEntry32{}))
		result, _, callErr = thread32Next.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	}
	if errno, ok := callErr.(syscall.Errno); ok && errno != 0 && errno != syscall.ERROR_NO_MORE_FILES {
		return windowsCallError("Thread32Next", callErr)
	}
	return fmt.Errorf("primary thread for Pi process %d was not found", pid)
}

func (tree *processTree) terminate(_ *exec.Cmd, _ bool) error {
	tree.mu.Lock()
	handle := tree.handle
	tree.mu.Unlock()
	if handle == 0 {
		return nil
	}
	result, _, callErr := terminateJobObject.Call(uintptr(handle), 1)
	if result == 0 {
		return windowsCallError("TerminateJobObject", callErr)
	}
	return nil
}

func (tree *processTree) close() error {
	tree.mu.Lock()
	handle := tree.handle
	tree.handle = 0
	tree.mu.Unlock()
	if handle == 0 {
		return nil
	}
	return syscall.CloseHandle(handle)
}

func windowsCallError(name string, err error) error {
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return fmt.Errorf("%s: %w", name, errno)
	}
	return fmt.Errorf("%s failed", name)
}
