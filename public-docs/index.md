---
title: Getting started
description: Install BySpace and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

BySpace runs coding agents on your machine and gives you a hosted browser Web app plus a CLI to control them from anywhere.

## CLI and daemon

Install the public package on every machine that runs agents:

```bash
npm install -g @bytetrue/byspace
byspace
```

BySpace prints a pairing link. Open it in a browser to connect the hosted Web app at [byspace.pages.dev](https://byspace.pages.dev). The daemon can also serve the same browser UI itself; see [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `BYSPACE_HOME` (defaults to `~/.byspace`).

## Docker

For servers, dev boxes, NAS devices, or homelab hosts, run the official image:

```bash
docker run -d --name byspace \
  -p 6777:6777 \
  -e BYSPACE_PASSWORD=change-me \
  -v "$PWD/byspace-home:/home/byspace" \
  -v "$PWD:/workspace" \
  ghcr.io/bytetrue/byspace:latest
```

Then open `http://localhost:6777`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, and security examples.

## Where next

- [Docker](/docs/docker), run the daemon and bundled web UI in a container.
- [Workspaces](/docs/workspaces), the project, workspace, and session model BySpace is built around.
- [Providers](/docs/providers), what a provider is and how BySpace wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/ByteTrue/byspace)
- [Report an issue](https://github.com/ByteTrue/byspace/issues)

## Prerequisites

BySpace manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, BySpace uses it for PR-aware worktrees and a few orchestration features.
