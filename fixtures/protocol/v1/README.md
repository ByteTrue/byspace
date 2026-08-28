# Protocol v1 fixtures

These files are the shared migration contract between the copied TypeScript protocol and the Go daemon.

- `valid/client-to-daemon`: accepted client WebSocket frames.
- `valid/daemon-to-client`: accepted daemon WebSocket frames.
- `compat`: mixed-version frames with unknown object fields; known fields must still decode.
- `invalid`: frames both implementations must reject.
- `binary.json`: terminal and file-transfer inputs with exact hexadecimal wire bytes.

Compatibility is intentionally asymmetric: unknown fields inside a known message are accepted, but unknown envelope or message discriminants are rejected because the daemon cannot route them safely.

This is a selected first-slice contract, not a declaration that every existing Paseo message is implemented by Go.
