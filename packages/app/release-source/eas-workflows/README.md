# Inactive EAS workflow source

These files preserve the upstream EAS and iOS review workflow implementation for source parity, maintenance, and future reference. They are intentionally outside `.eas/workflows/`, so EAS does not expose or execute them as active CD workflows.

BySpace's active client release CD is `.github/workflows/client-release.yml`:

- Android is built with Gradle from the immutable release tag, signed with the BySpace Android release key, verified with `apksigner`, and attached to the GitHub Release.
- iOS source, Expo prebuild, native modules, tests, EAS profiles, and Fastlane implementation remain maintained.
- iOS is not built, submitted, or uploaded by active CD because BySpace does not publish iOS.

Moving a file back under `.eas/workflows/` changes the product release boundary and requires an explicit user decision plus release-engineering review.
