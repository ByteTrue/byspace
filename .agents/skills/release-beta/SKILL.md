---
name: release-beta
description: Cut a beta release of BySpace. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta". Betas are release candidates on the beta channel — they carry an in-place changelog entry, don't move the website download target, and publish npm only on the beta dist-tag.
user-invocable: true
---

# Release beta

Read `docs/release.md` completely and follow **Required checks** and **Beta release** end-to-end.

Use a `vX.Y.Z-beta.N` tag and publish only the generated `@bytetrue/byspace` artifact with the explicit `beta` dist-tag. Never move npm `latest`, never push all local/upstream tags, and never publish before CI passes on the exact beta commit.
