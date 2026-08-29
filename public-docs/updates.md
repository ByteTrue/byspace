---
title: Updates
description: How BySpace stable and beta releases update the Web app, relay, CLI, and daemon.
nav: Updates
order: 5
category: Getting started
---

# Updates

BySpace publishes stable releases and optional beta release candidates.

## Stable

The hosted Web app and encrypted relay deploy automatically from `main`. Install or update the local CLI and daemon with:

```bash
npm install -g @bytetrue/byspace@latest
```

The daemon reports its version to the Web app so version mismatches are visible.

## Beta

Beta tags use Semantic Versioning prereleases such as `v0.2.0-beta.1`. Opt in with:

```bash
npm install -g @bytetrue/byspace@beta
```

Switch back with the stable command above. Beta packages may require the matching Web deployment when they introduce a new capability.

## Source and issues

Releases and source are published at [ByteTrue/byspace](https://github.com/ByteTrue/byspace). Report update regressions in the repository issue tracker.
