import { existsSync } from "node:fs";
import path from "node:path";

// The daemon and the relay under test are both subcommands of the Go single binary. `make build`
// suffixes it with `.exe` on Windows because Node spawns through CreateProcess, which appends
// `.exe` to an extension-less name instead of running the file, so an unsuffixed path cannot be
// launched there. Resolve it here rather than per spec: every copy of the name drifted.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Path to the built Go binary, or the `BYSPACE_E2E_DAEMON_BINARY` override. Throws when it is missing. */
export function goDaemonBinary(): string {
  const override = process.env.BYSPACE_E2E_DAEMON_BINARY;
  if (override) return override;

  const binary = path.join(
    REPO_ROOT,
    "bin",
    process.platform === "win32" ? "byspace.exe" : "byspace",
  );
  if (!existsSync(binary)) {
    throw new Error(
      `Go daemon binary not found at ${binary}. Run \`make build\` first ` +
        `(or point BYSPACE_E2E_DAEMON_BINARY at a built binary).`,
    );
  }
  return binary;
}
