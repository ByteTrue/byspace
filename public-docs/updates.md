---
title: Updates
description: Stable and Beta updates for BySpace Web, relay, CLI/daemon, Android, and Desktop clients.
nav: Updates
order: 5
category: Getting started
---

# Updates

Every BySpace release is one immutable channel tuple: npm CLI/daemon, hosted Web app, encrypted relay, signed Android APK, and Electron Desktop assets for macOS, Linux, and Windows all come from the same Git tag and source SHA.

## Download clients

Download the newest Stable clients from the [latest GitHub Release](https://github.com/ByteTrue/byspace/releases/latest). Each release includes:

- signed Android APK;
- macOS DMG/ZIP for Apple Silicon and Intel;
- Linux AppImage/deb/rpm/tar.gz for x64;
- Windows installer/portable ZIP for x64 and arm64;
- `client-release-manifest.json` and `SHA256SUMS.txt` for integrity verification.

The manifest reports the signing state of every asset. iOS is maintained in source and prebuild/tests, but BySpace does not publish an IPA, TestFlight build, or App Store release.

## Stable

Install or update the matching Stable CLI and daemon with:

```bash
npm install -g @bytetrue/byspace@latest
```

The daemon reports its version to the Web/Desktop/Android clients so version mismatches are visible.

## Beta

Beta tags use Semantic Versioning prereleases such as `v0.7.2-beta.1`. Download prerelease clients from the matching prerelease page and opt into the CLI/daemon with:

```bash
npm install -g @bytetrue/byspace@beta
```

Switch back with the Stable command above. Beta npm, Web, relay, Android, and Desktop artifacts are promoted and verified as one isolated channel.

## Source and issues

Releases and source are published at [ByteTrue/byspace](https://github.com/ByteTrue/byspace). Report update regressions in the repository issue tracker.
