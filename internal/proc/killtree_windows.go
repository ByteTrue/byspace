//go:build windows

package proc

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// cancelTree ensures that when a CommandContext ends on Windows, all descendant processes
// (e.g. node.exe spawned under a .cmd wrapper) are terminated as well (ported from magpie's
// internal/proc/killtree_windows.go / #2341).
func cancelTree(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			killDescendants(cmd.Process.Pid)
			return cmd.Process.Kill()
		}
		return nil
	}
}

func killDescendants(pid int) {
	killAll(descendants(uint32(pid)))
}

func killAll(pids []uint32) {
	for _, d := range pids {
		h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, d)
		if err != nil {
			continue
		}
		_ = windows.TerminateProcess(h, 1)
		_ = windows.CloseHandle(h)
	}
}

func descendants(pid uint32) []uint32 {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	kids := map[uint32][]uint32{}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if e.ProcessID != e.ParentProcessID {
			kids[e.ParentProcessID] = append(kids[e.ParentProcessID], e.ProcessID)
		}
	}
	var out []uint32
	seen := map[uint32]bool{pid: true}
	queue := []uint32{pid}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		born, ok := procStartTime(p)
		if !ok {
			continue
		}
		for _, k := range kids[p] {
			if seen[k] {
				continue
			}
			if t, ok := procStartTime(k); !ok || t < born {
				continue
			}
			seen[k] = true
			out = append(out, k)
			queue = append(queue, k)
		}
	}
	return out
}

func procStartTime(pid uint32) (int64, bool) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, false
	}
	defer windows.CloseHandle(h)
	var c, x, k, u windows.Filetime
	if err := windows.GetProcessTimes(h, &c, &x, &k, &u); err != nil {
		return 0, false
	}
	return int64(c.HighDateTime)<<32 | int64(c.LowDateTime), true
}
