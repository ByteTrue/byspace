# Bundled ConPTY payload

`win32-x64/` and `win32-arm64/` contain `conpty.dll` and `OpenConsole.exe` built from
[microsoft/terminal](https://github.com/microsoft/terminal) (OpenConsole build 1.23.251008001),
taken from the `node-pty` 1.1.0 prebuilt packages.

The inbox ConPTY does not forward a child process's mouse-mode DECSETs to the terminal, so a
full-screen TUI's wheel becomes arrow keys. The bundled OpenConsole forwards them.

Both files are MIT licensed; see `LICENSE` (node-pty) and `LICENSE-OpenConsole` (Microsoft).
