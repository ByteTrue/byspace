# Self-hosting BySpace

BySpace has no server to babysit: the daemon runs on your own machine (npm
package `@bytetrue/byspace`), and the web UI is static files. What you can
self-host is one container, `ghcr.io/bytetrue/byspace`, which serves the web
UI and the relay from the same port:

- `https://your-host/` — the web UI (static build, no daemon inside).
- `wss://your-host/ws` — the relay, for clients that prefer your relay over
  the hosted one.

The daemon image that used to bundle daemon + web was retired: agents need
your real dev environment, so the daemon belongs on your machine. Already
running it? `ghcr.io/bytetrue/byspace:<version>` keeps its published tags but
gets no new ones, and `ghcr.io/bytetrue/byspace:latest` stays at the last
daemon release. Move to the npm package on the machine that holds your
repositories, or build your own image — see
[Running the daemon in a container](#running-the-daemon-in-a-container).

Image sources live in [`docker/`](../docker/).

## Quick start

```bash
curl -O https://raw.githubusercontent.com/ByteTrue/byspace/main/docker/compose.yml
curl -O https://raw.githubusercontent.com/ByteTrue/byspace/main/docker/Caddyfile
docker compose up -d
```

Open `http://localhost:8080` and follow the connect guide: install the daemon
on your machine with `npm install -g @bytetrue/byspace`, pair, done.

Without TLS this is fine for trying things out on a trusted LAN. For anything
else, read [TLS](#tls) and [the HTTP cost table](#what-you-lose-on-plain-http)
first.

## What is where

| Piece  | Runs where                               | Notes                                                                                                                       |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Web UI | container `byspace`, port `:8080`        | static build, no daemon inside                                                                                              |
| Daemon | your machine, npm package                | `byspace onboard --web-origin http://your-host:8080` points pairing links at your web (see the connect guide in the web UI) |
| Relay  | same container, or `relay.byspace.cc.cd` | the daemon normally uses the hosted relay; a self-hosted one needs `--relay` at onboard time                                |

Sessions on a self-hosted relay live in memory only; restarting the container
just forces reconnects.

## Using only the relay

The web UI is optional. If you use the hosted web UI (`app.byspace.cc.cd`)
and only want your own relay, point the daemon at it:

```bash
byspace onboard --relay-endpoint your-host:443
```

Behind the hosted HTTPS web UI, browsers refuse non-loopback `ws://`
connections, so a self-hosted relay must sit behind TLS — see the next
section. The endpoint defaults to `wss://` (port 443); pass `ws://host:port`
if your relay is plain HTTP (that only works from non-HTTPS pages).

## Version pinning

Pin `BYSPACE_VERSION` for reproducible deploys (e.g. `0.16.4`); `latest`
follows the newest stable release. Beta builds publish the exact prerelease
tag only (e.g. `0.17.0-beta.1`) and never touch `latest`.

```bash
BYSPACE_VERSION=0.16.4 docker compose up -d
```

## TLS

Enable the `tls` profile and set a domain; caddy terminates TLS with
automatic certificates. One domain covers both the web UI and the relay
WebSocket — `https://your-host/` and `wss://your-host/ws` from one cert:

```bash
BYSPACE_DOMAIN=app.example.com docker compose --profile tls up -d
```

With TLS on, onboard the daemon fully self-hosted:

```bash
byspace onboard --web-origin https://app.example.com --relay-endpoint app.example.com:443
```

Already behind your own reverse proxy? Forward normal HTTP and WebSocket
upgrades to the container's `:8080` and terminate TLS yourself. If you reach
the daemon by DNS name, allow that host header with `BYSPACE_HOSTNAMES` on
the daemon.

TLS also matters for what the browser allows — see the next section.

## What you lose on plain HTTP

The web UI is a PWA and talks WebSockets, so a plain-`http://` origin behaves
differently than a secure one:

| Capability                            | Plain HTTP                                              | HTTPS            |
| ------------------------------------- | ------------------------------------------------------- | ---------------- |
| Terminal clipboard copy/paste         | unavailable (browser denies clipboard API off-loopback) | works            |
| PWA install                           | no                                                      | yes              |
| Web Push                              | no                                                      | yes              |
| Daemon password on direct connections | sent in cleartext                                       | protected by TLS |

Direct `ws://` connections to an `https://` page are blocked by browsers for
non-loopback hosts; use the relay (or TLS on the daemon side) for remote
access. E2EE relay traffic is unaffected: it is encrypted end-to-end
regardless of TLS.

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

- The container serves static files and the relay. Daemon auth applies when
  the web UI talks to your daemon, exactly as with the hosted web UI.
- The relay is untrusted by design; all relay traffic is end-to-end encrypted
  (see [SECURITY.md](../SECURITY.md)).
- Set `BYSPACE_PASSWORD` on the daemon for any direct connection that leaves
  loopback.

See [SECURITY.md](../SECURITY.md) for the full trust model.

## Building locally

```bash
docker build -f docker/Dockerfile -t byspace:local .
```

The build compiles from source in this checkout: the web UI is exported, the
relay package is packed, and one runtime image carries both. `BYSPACE_VERSION`
is an optional build arg that asserts the source-tree version. On release
tags, CI publishes the image multi-arch (amd64/arm64) to
`ghcr.io/bytetrue/byspace`.
