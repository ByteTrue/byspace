---
name: release-beta
description: Cut a beta release of BySpace. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta". Betas publish npm on the beta dist-tag and deploy only the isolated Beta Web/Relay channel.
user-invocable: true
---

# Release beta

Read `docs/release.md` in the BySpace repo and follow the **Beta release** section end-to-end, including its final verification.

During preparation, classify the previous-stable-to-`HEAD` diff as patch or minor and show the target version and rationale to the user. Agents never select a major version autonomously.

Each beta updates an in-place `CHANGELOG.md` entry (`## X.Y.Z-beta.N`) that gets overwritten at promotion, publishes npm only on the explicit `beta` dist-tag, and deploys only `byspace-beta` Pages plus `byspace-relay-beta`. Stable surfaces must remain unchanged.
