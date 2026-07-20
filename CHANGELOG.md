# Changelog

## 0.2.0-beta.2 - 2026-07-20

Second clean-history BySpace beta, rebuilt from the Paseo `v0.2.0-beta.1` source snapshot (`0bec06c2db7d3ee071416cde80229eabd682b03e`).

- Retains the browser Web/PWA, CLI, local daemon, encrypted relay, and agent provider integrations.
- Removes Electron desktop, native iOS/Android, the marketing website, and Electron Browser automation.
- Keeps Stable (`npm latest`, `byspace.pages.dev`, `byspace-relay`) isolated from Beta (`npm beta`, `byspace-beta.pages.dev`, `byspace-relay-beta`).
- Makes prerelease daemons generate Beta pairing links, allow the Beta Web origin, connect to the Beta relay, and self-update from npm `beta`.
- Deploys Web and Relay only from an immutable release tag after exact-SHA CI and npm publication succeed.
