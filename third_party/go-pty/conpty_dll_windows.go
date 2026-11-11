//go:build windows

package pty

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// conptyDLL is the modern ConPTY implementation shipped next to the app.
//
// The inbox ConPTY on Windows does not forward a child's mouse-mode DECSETs to the terminal, so a
// full-screen TUI's wheel is turned into arrow keys by the client (microsoft/terminal#4856 and the
// OpenConsole builds carry the forwarding). The payload is loaded only when the environment names
// it; without it the package keeps using the inbox API.
type conptyDLL struct {
	create  uintptr
	resize  uintptr
	close   uintptr
	release uintptr
}

var (
	conptyMu   sync.Mutex
	conptyPath string
	conptyImpl *conptyDLL
	ptyCounter atomic.Uint64
)

// loadConptyDLL resolves BYSPACE_CONPTY_DLL on every call until it succeeds.
//
// Not a sync.Once: the terminal package may extract the payload after an earlier StartSession had
// already asked for it (antivirus lock, permission), and a cached nil would keep the inbox
// implementation for the whole daemon lifetime even after a successful retry.
func loadConptyDLL() *conptyDLL {
	path := os.Getenv("BYSPACE_CONPTY_DLL")
	conptyMu.Lock()
	defer conptyMu.Unlock()
	if conptyImpl != nil && conptyPath == path {
		return conptyImpl
	}
	conptyImpl = nil
	conptyPath = path
	if path == "" {
		return nil
	}
	dll, err := windows.LoadLibraryEx(path, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH)
	if err != nil {
		return nil
	}
	impl := &conptyDLL{}
	var loadErr error
	if impl.create, loadErr = windows.GetProcAddress(dll, "ConptyCreatePseudoConsole"); loadErr != nil {
		_ = windows.FreeLibrary(dll)
		return nil
	}
	if impl.resize, loadErr = windows.GetProcAddress(dll, "ConptyResizePseudoConsole"); loadErr != nil {
		_ = windows.FreeLibrary(dll)
		return nil
	}
	if impl.close, loadErr = windows.GetProcAddress(dll, "ConptyClosePseudoConsole"); loadErr != nil {
		_ = windows.FreeLibrary(dll)
		return nil
	}
	if impl.release, loadErr = windows.GetProcAddress(dll, "ConptyReleasePseudoConsole"); loadErr != nil {
		_ = windows.FreeLibrary(dll)
		return nil
	}
	conptyImpl = impl
	return conptyImpl
}

func (d *conptyDLL) createPseudoConsole(size windows.Coord, in, out windows.Handle, flags uint32, pc *windows.Handle) error {
	coord := uintptr(uint32(uint16(size.X)) | uint32(uint16(size.Y))<<16)
	hr, _, _ := syscall.SyscallN(d.create, coord, uintptr(in), uintptr(out), uintptr(flags), uintptr(unsafe.Pointer(pc)))
	if hr != 0 {
		return fmt.Errorf("ConptyCreatePseudoConsole failed: hr=%#x", hr)
	}
	return nil
}

func (d *conptyDLL) resizePseudoConsole(pc windows.Handle, width, height int) error {
	coord := uintptr(uint32(uint16(width)) | uint32(uint16(height))<<16)
	hr, _, _ := syscall.SyscallN(d.resize, uintptr(pc), coord)
	if hr != 0 {
		return fmt.Errorf("ConptyResizePseudoConsole failed: hr=%#x", hr)
	}
	return nil
}

func (d *conptyDLL) closePseudoConsole(pc windows.Handle) {
	_, _, _ = syscall.SyscallN(d.close, uintptr(pc))
}

func (d *conptyDLL) releasePseudoConsole(pc windows.Handle) {
	_, _, _ = syscall.SyscallN(d.release, uintptr(pc))
}

// newDLLPty creates a pseudo console through the bundled implementation and connects the data
// pipes the same way node-pty does: the pseudo console owns the server ends, the terminal reads
// and writes client ends.
func newDLLPty(dll *conptyDLL) (ConPty, error) {
	base := fmt.Sprintf(`\\.\pipe\byspace-%d-%d`, os.Getpid(), ptyCounter.Add(1))
	inName := base + "-in"
	outName := base + "-out"

	inServer, err := createNamedPipe(inName)
	if err != nil {
		return nil, fmt.Errorf("create input pipe: %w", err)
	}
	outServer, err := createNamedPipe(outName)
	if err != nil {
		_ = windows.CloseHandle(inServer)
		return nil, fmt.Errorf("create output pipe: %w", err)
	}

	var hpc windows.Handle
	coord := windows.Coord{X: 80, Y: 25}
	if err := dll.createPseudoConsole(coord, inServer, outServer, 0, &hpc); err != nil {
		_ = windows.CloseHandle(inServer)
		_ = windows.CloseHandle(outServer)
		return nil, err
	}

	inClient, err := openPipeClient(inName, windows.GENERIC_WRITE)
	if err != nil {
		dll.closePseudoConsole(hpc)
		_ = windows.CloseHandle(inServer)
		_ = windows.CloseHandle(outServer)
		return nil, fmt.Errorf("open input pipe: %w", err)
	}
	outClient, err := openPipeClient(outName, windows.GENERIC_READ)
	if err != nil {
		_ = windows.CloseHandle(inClient)
		dll.closePseudoConsole(hpc)
		_ = windows.CloseHandle(inServer)
		_ = windows.CloseHandle(outServer)
		return nil, fmt.Errorf("open output pipe: %w", err)
	}
	// The clients are connected; these calls complete the server side (ERROR_PIPE_CONNECTED).
	_ = windows.ConnectNamedPipe(inServer, nil)
	_ = windows.ConnectNamedPipe(outServer, nil)

	return &conPty{
		handle:    hpc,
		inPipe:    os.NewFile(uintptr(inClient), inName),
		outPipe:   os.NewFile(uintptr(outClient), outName),
		inServer:  inServer,
		outServer: outServer,
		dll:       dll,
	}, nil
}

// fileFlagFirstPipeInstance rejects a pre-existing name. Pipe names are predictable (pid +
// counter), so without it another local process could hold the name and force the inbox fallback.
const fileFlagFirstPipeInstance = 0x00080000

func createNamedPipe(name string) (windows.Handle, error) {
	namep, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windows.InvalidHandle, err
	}
	return windows.CreateNamedPipe(
		namep,
		windows.PIPE_ACCESS_DUPLEX|fileFlagFirstPipeInstance,
		windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT,
		1,
		128*1024,
		128*1024,
		0,
		nil,
	)
}

func openPipeClient(name string, access uint32) (windows.Handle, error) {
	namep, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return windows.InvalidHandle, err
	}
	handle, err := windows.CreateFile(namep, access, 0, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return windows.InvalidHandle, err
	}
	if handle == windows.InvalidHandle {
		return windows.InvalidHandle, errors.New("invalid pipe handle")
	}
	return handle, nil
}
