---
title: Docker
description: Self-host the BySpace web UI and relay with the official containers.
nav: Docker
order: 6
category: Getting started
---

# Docker

BySpace has no server to babysit: the daemon runs on your own machine (npm
package `@bytetrue/byspace`), and the web UI is static files. The official
containers are two small images for self-hosting:

- `ghcr.io/bytetrue/byspace-web` — the web UI behind unprivileged nginx.
- `ghcr.io/bytetrue/byspace-relay` — the relay as a Node service.

Start the web UI:

```bash
curl -O https://raw.githubusercontent.com/ByteTrue/byspace/main/docker/compose.yml
curl -O https://raw.githubusercontent.com/ByteTrue/byspace/main/docker/Caddyfile
docker compose up -d
```

Open `http://localhost:8080` and follow the connect guide: install the daemon
on your machine with `npm install -g @bytetrue/byspace`, pair, done.

## Optional: self-hosted relay

```bash
docker compose --profile relay up -d
```

The daemon normally uses the hosted relay at `relay.byspace.cc.cd:443`. Point
it at your own relay instead when pairing (`--relay`).

## Version pinning

Pin `BYSPACE_VERSION` for reproducible deploys (e.g. `0.16.4`); `latest`
follows the newest stable release. Beta builds publish the exact prerelease
tag only (e.g. `0.17.0-beta.1`) and never touch `latest`.

## TLS

Enable the `tls` profile and set a domain; caddy terminates TLS with automatic
certificates:

```bash
BYSPACE_DOMAIN=app.example.com docker compose --profile tls up -d
```

To terminate TLS for the relay too, uncomment the relay block in `Caddyfile`,
set `RELAY_DOMAIN`, and run with `--profile relay --profile tls`.

Plain HTTP is fine for trying things out on a trusted LAN, but the browser
then withholds PWA install, Web Push, and clipboard access, and daemon
passwords on direct connections travel in cleartext. See
[Docker](/docs/docker) in the repo for the full tradeoff table.

## What is where

| Piece  | Runs where                                            | Notes                                                                                 |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web UI | container `web`, nginx on `:8080`                     | static build, no daemon inside                                                        |
| Daemon | your machine, npm package                             | `byspace onboard --web-origin http://your-host:8080` points pairing links at your web |
| Relay  | container `relay` (optional) or `relay.byspace.cc.cd` | E2EE relay, untrusted by design                                                       |

## Running the daemon in a container

Agents run your real project toolchains, so the daemon normally belongs next
to them, on your machine. If you want a headless daemon anyway, install the
npm package in your own image and add the CLIs you use:

```Dockerfile
FROM node:22
RUN npm install -g @bytetrue/byspace @anthropic-ai/claude-code @openai/codex opencode-ai
EXPOSE 6777
CMD ["byspace", "daemon", "start"]
```

Set `BYSPACE_HOME` to a volume for persistent state, and `BYSPACE_PASSWORD`
whenever the port is reachable beyond loopback.

## Security

The web UI container serves static files only; daemon auth applies when the
web UI talks to your daemon, exactly as with the hosted web UI. The relay is
untrusted by design — all relay traffic is end-to-end encrypted.

Set `BYSPACE_PASSWORD` on the daemon for any direct connection that leaves
loopback. See [Security](/docs/security) for the full trust model.
