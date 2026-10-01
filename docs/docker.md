# Self-hosting BySpace

BySpace has no server to babysit: the daemon runs on your own machine (npm
package `@bytetrue/byspace`), and the web UI is static files. What you can
self-host are the two published containers:

- `ghcr.io/bytetrue/byspace-web` — the web UI behind unprivileged nginx.
- `ghcr.io/bytetrue/byspace-relay` — the relay as a Node service, if you prefer
  your own relay over the hosted one.

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

| Piece  | Runs where                                            | Notes                                                                                                                       |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Web UI | container `web`, nginx on `:8080`                     | static build, no daemon inside                                                                                              |
| Daemon | your machine, npm package                             | `byspace onboard --web-origin http://your-host:8080` points pairing links at your web (see the connect guide in the web UI) |
| Relay  | container `relay` (optional) or `relay.byspace.cc.cd` | the daemon normally uses the hosted relay; a self-hosted one needs `--relay` at onboard time                                |

Sessions on the self-hosted relay live in memory only; restarting the relay
just forces reconnects.

## Version pinning

Pin `BYSPACE_VERSION` for reproducible deploys (e.g. `0.16.4`); `latest`
follows the newest stable release. Beta builds publish the exact prerelease
tag only (e.g. `0.17.0-beta.1`) and never touch `latest`.

```bash
BYSPACE_VERSION=0.16.4 docker compose up -d
```

## TLS

Enable the `tls` profile and set a domain; caddy terminates TLS with
automatic certificates for the web UI:

```bash
BYSPACE_DOMAIN=app.example.com docker compose --profile tls up -d
```

To terminate TLS for the relay too, uncomment the relay block in `Caddyfile`,
set `RELAY_DOMAIN`, and run with `--profile relay --profile tls`. Then point
the daemon at the relay when you onboard it:

```bash
byspace onboard --relay-endpoint relay.example.com:443
```

The endpoint defaults to `wss://` (port 443); pass `ws://host:port` if your
relay is plain HTTP.

Already behind your own reverse proxy? Forward normal HTTP and WebSocket
upgrades to the web container's `:8080` and terminate TLS yourself. If you
reach the daemon by DNS name, allow that host header with `BYSPACE_HOSTNAMES`
on the daemon.

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

- The web UI container serves static files only. Daemon auth applies when the
  web UI talks to your daemon, exactly as with the hosted web UI.
- The relay is untrusted by design; all relay traffic is end-to-end encrypted
  (see [SECURITY.md](../SECURITY.md)).
- Set `BYSPACE_PASSWORD` on the daemon for any direct connection that leaves
  loopback.

See [SECURITY.md](../SECURITY.md) for the full trust model.

## Building locally

```bash
docker build -f docker/web.Dockerfile -t byspace-web:local .
docker build -f docker/relay.Dockerfile -t byspace-relay:local .
```

Both builds compile from source in this checkout. `BYSPACE_VERSION` is an
optional build arg that asserts the source-tree version. On release tags, CI
publishes both images multi-arch (amd64/arm64) to `ghcr.io/bytetrue/`.
