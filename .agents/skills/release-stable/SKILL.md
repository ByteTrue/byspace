---
name: release-stable
description: Cut a stable release of BySpace (fresh patch or minor, or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:minor", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Read `docs/release.md` in the BySpace repo and follow the **Stable release or beta promotion** section end-to-end, including its final verification.

For a fresh release, classify the previous-stable-to-`HEAD` diff as patch or minor and show the target version and rationale to the user. Agents never select a major version autonomously.

Do not finish until npm `latest`, Stable Web, and Stable Relay are verified and Beta is confirmed unchanged.
