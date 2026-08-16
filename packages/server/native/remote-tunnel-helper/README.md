# macOS Remote Tunnel helper

This directory contains the first source-only implementation slice for the privileged macOS Remote Tunnel data plane. It is not included in the npm package or connected to daemon bootstrap yet; a development installation may exist on the validation machine.

## Boundary

The root supervisor is the long-lived privileged boundary. It creates one owner-only Unix socket, accepts sequential daemon sessions, and forks the sibling session helper without asking for authorization again. The session helper authenticates the peer UID, then owns one TUN/route session while its HEV/lwIP child runs as the daemon UID.

The explicit installer copies the two fixed binaries into `/Library/PrivilegedHelperTools`, installs one `launchd` job with `AbandonProcessGroup=false`, and starts it through one administrator authorization. The authorized shell receives its installer logic inline, copies artifacts into root-owned staging, rechecks their SHA-256 values and signatures, and publishes them atomically. Runtime daemon and test processes connect to `/var/run/byspace-tunnel-UID.sock`; they must never invoke `osascript`, `sudo`, or another root command for START, STOP, reconnect, or cleanup. The UID check authenticates the local daemon account, not a cryptographic token. This is still a development source slice: daemon integration, trusted upgrade/remove, Developer ID signing, and notarization remain open.

## Build

Development builds currently target macOS 14 or newer on arm64 and are ad-hoc signed:

```bash
node packages/server/native/remote-tunnel-helper/build.mjs
```

The script clones the pinned HEV source when `BYSPACE_HEV_SOURCE_DIR` is not set. A configured checkout must match every locked parent/submodule commit and remote, contain the expected gitlinks and license texts, and be recursively clean, including untracked files. The build materializes parent and submodule contents with `git archive` from the exact locked object IDs, applies the hash-locked readiness patch in a temporary tree, and rebuilds under a controlled tool environment without mutating or compiling from the supplied working tree.

macOS `lockf(1)` holds a kernel-released exclusive lock for the entire artifact build. Outputs are staged under ignored `artifacts/native/`; a complete staged artifact replaces `darwin-arm64/` with rollback protection, a failed build preserves the last complete artifact, and the next invocation recovers an interruption between the two publish renames. The manifest records the deployment target, toolchain, source locks, patch hashes, transitive HEV/lwIP licenses, and separate pre-sign and signed SHA-256 digests.

The source-only build intentionally supports ad-hoc signing only. `--release` and arbitrary signing identities are rejected until the macOS CI path verifies the expected Developer ID certificate and Team ID and defines notarization for the distributed container. This artifact is not eligible for package promotion.

Run the unprivileged protocol test with:

```bash
node packages/server/native/remote-tunnel-helper/build.mjs --protocol-test
```

## One-time installation

```bash
node packages/server/native/remote-tunnel-helper/install.mjs --install
```

This is the only command in this slice that requests macOS administrator authorization. It installs the supervisor and session helper together and starts the persistent LaunchDaemon. `--install` is initial-install only: if any installed binary or plist is already present, it fails before invoking `osascript`, and the root script independently refuses an existing job or artifact after taking its installation lock. Do not wrap individual tunnel tests or daemon sessions in `osascript ... with administrator privileges`; use the installed socket.

A trusted passwordless upgrade path is not implemented yet. It must accept only BySpace artifacts authenticated by the release Team ID/notarized distribution boundary; the current ad-hoc development supervisor cannot safely self-update and is not a release artifact.
