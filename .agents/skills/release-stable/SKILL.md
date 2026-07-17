---
name: release-stable
description: Cut a stable release of BySpace (fresh patch or minor, or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:minor", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Read `docs/release.md` completely and follow **Required checks** and **Stable release** end-to-end. Do not publish or push a tag until CI has passed on the exact release commit.

Before changing versions or the changelog, inspect the complete previous-stable-to-`HEAD` diff, classify a fresh release as patch or minor, and show the target version plus rationale for explicit user approval. Use `npm run version:all:patch` or `npm run version:all:minor`. Never choose a major release autonomously or bump merely to retry a failed build/tag workflow.

Publish only the generated `@bytetrue/byspace` artifact. Push only the intended `vX.Y.Z` tag; never push all local/upstream tags. Verify npm, GitHub Release, Pages, relay, and Docker endpoints before declaring completion.
