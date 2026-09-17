---
title: Updates
description: How BySpace releases work, the difference between stable and beta channels, and how to opt in to earlier updates.
nav: Updates
order: 5
category: Getting started
---

# Updates

BySpace ships updates through two channels: **Stable** and **Beta**.

Most releases go out on the stable channel. Betas are release candidates that let you test what's coming next before it rolls out to everyone.

## Version numbers

BySpace follows [Semantic Versioning](https://semver.org) with prerelease tags.

A stable release looks like this:

```
v0.1.90
```

A beta for the same release looks like this:

```
v0.1.90-beta.1
```

If a release needs more testing, we cut additional betas:

```
v0.1.92-beta.1
v0.1.92-beta.2
v0.1.92-beta.3
```

When the release is ready, the final stable tag is `v0.1.92` — not `v0.1.93`. The betas are checkpoints on the way to the same stable version.

## Stable channel

The stable channel is the default, and it is what most users should run.

The stable Web/PWA is served at [app.byspace.cc.cd](https://app.byspace.cc.cd). A browser loads the current build on each visit, so there is nothing to update. Update the CLI and daemon with npm:

```bash
npm install -g @bytetrue/byspace
```

## Beta channel

The beta channel gets every prerelease as soon as it's published. When a beta is promoted to stable, beta users receive that stable version.

Betas are the best way to get fixes and features early. If you hit a bug, report it — beta feedback is what makes stable releases reliable.

The beta Web/PWA is served at [app-beta.byspace.cc.cd](https://app-beta.byspace.cc.cd). Install the beta CLI and daemon with:

```bash
npm install -g @bytetrue/byspace@beta
```

## What to do if something breaks

Beta builds are expected to have rough edges. If a beta causes problems, install the stable release again:

```bash
npm install -g @bytetrue/byspace@latest
```

If you need a fix that hasn't shipped to stable yet, stay on beta and report the issue. Most problems found in beta are fixed before the stable release.
