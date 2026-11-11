# Forked go-pty

Upstream: `github.com/aymanbagabas/go-pty` v0.2.3 (MIT, see `LICENSE`).

**Why this copy exists:** upstream's Windows backend always creates the pseudo console with the
inbox `kernel32!CreatePseudoConsole`. The inbox ConPTY does not forward a child's mouse-mode DECSETs
(`?1000h`, `?1002h`, `?1003h`, `?1006h`) to the terminal ([microsoft/terminal#4856]), so a
full-screen TUI's wheel is turned into arrow keys by the terminal client. The copy loads the
bundled OpenConsole (`internal/terminal/conpty/`) through `BYSPACE_CONPTY_DLL` and keeps the inbox
path as the fallback when the payload is absent or cannot be created.

**Changed files:**

- `pty_windows.go` — `conPty` carries the DLL and the named-pipe server ends; `newDLLPty` uses two
  named pipes (node-pty's layout: the pseudo console owns the server ends, the terminal reads and
  writes client ends) and `afterStart` releases the pseudo console after `CreateProcess`.
- `cmd_windows.go` — calls `afterStart` once the client process is attached.
- `conpty_dll_windows.go` (new) — loads `ConptyCreatePseudoConsole`, `ConptyResizePseudoConsole`,
  `ConptyClosePseudoConsole`, `ConptyReleasePseudoConsole` from the payload.

**When upgrading:** re-apply those three changes; everything else is upstream.

**Verified 2026-11-11** on Windows 11 (build 26300): Pi 1.5.2 full-screen emits `1000/1002/1003/1006`
through `terminal.StartSession` with the bundled payload; the inbox implementation drops them.

[microsoft/terminal#4856]: https://github.com/microsoft/terminal/issues/4856
