---
name: release-stable
description: Cut a stable release of BySpace (fresh patch or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Read `docs/release.md` completely and follow **Required checks** and **Stable release** end-to-end. Do not publish or push a tag until CI has passed on the exact release commit.

Publish only the generated `@bytetrue/byspace` artifact. Push only the intended `vX.Y.Z` tag; never push all local/upstream tags. Verify npm, GitHub Release, Pages, relay, and Docker endpoints before declaring completion.
