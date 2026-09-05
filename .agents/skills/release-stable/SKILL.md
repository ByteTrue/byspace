---
name: release-stable
description: Cut a stable release of BySpace (fresh patch or minor, or promote from beta). Use when the user says "release stable", "ship stable", "promote", "release:patch", "release:minor", "release:promote", or "/release-stable".
user-invocable: true
---

# Release stable

Follow the applicable flow and the **Stable release (or promotion)** completion checklist in `docs/release.md` end-to-end.

Android is fully CI-driven: the version tag triggers the Android APK Release workflow (build, sign, verify, upload). Never build the APK locally as part of a release — the local path in `docs/android.md` exists only as a CI-outage fallback, and a keystore rotation must refresh all four GitHub secrets first.
