---
name: release-beta
description: Cut a beta release of BySpace. Use when the user says "release beta", "cut a beta", "ship a beta", "beta release", or "/release-beta".
user-invocable: true
---

# Release beta

Follow the **Beta flow** and **Beta release** completion checklist in `docs/release.md` end-to-end.

Android is fully CI-driven: the version tag triggers the Android APK Release workflow (build, sign, verify, upload). Never build the APK locally as part of a release — the local path in `docs/android.md` exists only as a CI-outage fallback, and a keystore rotation must refresh all four GitHub secrets first.
