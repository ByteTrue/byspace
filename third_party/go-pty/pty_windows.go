//go:build windows
// +build windows

package pty

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	_PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x20016 // nolint:revive
)

var (
	errClosedConPty = errors.New("pseudo console is closed")
	errNotStarted   = errors.New("process not started")
)

// conPty is a Windows console pseudo-terminal.
// It uses Windows pseudo console API to create a console that can be used to
// start processes attached to it.
//
// See: https://docs.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
type conPty struct {
	handle          windows.Handle
	inPipe, outPipe *os.File
	// inServer/outServer are the pseudo console ends of the named pipes, only used when dll is set.
	inServer, outServer windows.Handle
	// dll is the external conpty implementation, nil when the inbox API is used.
	dll *conptyDLL
	mtx sync.RWMutex
}

var _ Pty = &conPty{}

func newPty() (ConPty, error) {
	if dll := loadConptyDLL(); dll != nil {
		if pty, err := newDLLPty(dll); err == nil {
			return pty, nil
		}
		// A payload that cannot start a pseudo console must not take the terminal down with it:
		// fall back to the inbox implementation and keep terminals working.
	}
	ptyIn, inPipeOurs, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create pipes for pseudo console: %w", err)
	}

	outPipeOurs, ptyOut, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create pipes for pseudo console: %w", err)
	}

	var hpc windows.Handle
	coord := windows.Coord{X: 80, Y: 25}
	err = windows.CreatePseudoConsole(coord, windows.Handle(ptyIn.Fd()), windows.Handle(ptyOut.Fd()), 0, &hpc)
	if err != nil {
		return nil, fmt.Errorf("failed to create pseudo console: %w", err)
	}

	if err := ptyOut.Close(); err != nil {
		return nil, fmt.Errorf("failed to close pseudo console handle: %w", err)
	}
	if err := ptyIn.Close(); err != nil {
		return nil, fmt.Errorf("failed to close pseudo console handle: %w", err)
	}

	return &conPty{
		handle:  hpc,
		inPipe:  inPipeOurs,
		outPipe: outPipeOurs,
	}, nil
}

// Close implements Pty.
func (p *conPty) Close() error {
	p.mtx.Lock()
	defer p.mtx.Unlock()

	if p.dll != nil {
		p.dll.closePseudoConsole(p.handle)
	} else {
		windows.ClosePseudoConsole(p.handle)
	}
	if p.inServer != 0 {
		_ = windows.CloseHandle(p.inServer)
	}
	if p.outServer != 0 {
		_ = windows.CloseHandle(p.outServer)
	}
	return errors.Join(p.inPipe.Close(), p.outPipe.Close())
}

// Command implements Pty.
func (p *conPty) Command(name string, args ...string) *Cmd {
	c := &Cmd{
		pty:  p,
		Path: name,
		Args: append([]string{name}, args...),
	}
	return c
}

// CommandContext implements Pty.
func (p *conPty) CommandContext(ctx context.Context, name string, args ...string) *Cmd {
	if ctx == nil {
		panic("nil context")
	}
	c := p.Command(name, args...)
	c.ctx = ctx
	c.Cancel = func() error {
		return c.Process.Kill()
	}
	return c
}

// Name implements Pty.
func (*conPty) Name() string {
	return "windows-pty"
}

// Read implements Pty.
func (p *conPty) Read(b []byte) (n int, err error) {
	return p.outPipe.Read(b)
}

// Resize implements Pty.
func (p *conPty) Resize(width int, height int) error {
	p.mtx.RLock()
	defer p.mtx.RUnlock()
	if p.dll != nil {
		if err := p.dll.resizePseudoConsole(p.handle, width, height); err != nil {
			return fmt.Errorf("failed to resize pseudo console: %w", err)
		}
		return nil
	}
	if err := windows.ResizePseudoConsole(p.handle, windows.Coord{X: int16(width), Y: int16(height)}); err != nil {
		return fmt.Errorf("failed to resize pseudo console: %w", err)
	}
	return nil
}

// Write implements Pty.
func (p *conPty) Write(b []byte) (n int, err error) {
	return p.inPipe.Write(b)
}

// Fd implements Pty.
func (p *conPty) Fd() uintptr {
	p.mtx.RLock()
	defer p.mtx.RUnlock()
	return uintptr(p.handle)
}

// InputPipe implements ConPty.
func (p *conPty) InputPipe() *os.File {
	return p.inPipe
}

// OutputPipe implements ConPty.
func (p *conPty) OutputPipe() *os.File {
	return p.outPipe
}

// afterStart releases the pseudo console once the client process is attached.
//
// The external implementation hands the console to the client at CreateProcess time; holding the
// caller reference afterwards keeps OpenConsole alive past the client (node-pty releases here too).
func (p *conPty) afterStart() {
	p.mtx.Lock()
	defer p.mtx.Unlock()
	if p.dll == nil {
		return
	}
	p.dll.releasePseudoConsole(p.handle)
	if p.inServer != 0 {
		_ = windows.CloseHandle(p.inServer)
		p.inServer = 0
	}
	if p.outServer != 0 {
		_ = windows.CloseHandle(p.outServer)
		p.outServer = 0
	}
}

// updateProcThreadAttribute updates the passed in attribute list to contain the entry necessary for use with
// CreateProcess.
func (p *conPty) updateProcThreadAttribute(attrList *windows.ProcThreadAttributeListContainer) error {
	p.mtx.RLock()
	defer p.mtx.RUnlock()

	if p.handle == 0 {
		return errClosedConPty
	}

	if err := attrList.Update(
		_PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		unsafe.Pointer(p.handle),
		unsafe.Sizeof(p.handle),
	); err != nil {
		return fmt.Errorf("failed to update proc thread attributes for pseudo console: %w", err)
	}

	return nil
}
