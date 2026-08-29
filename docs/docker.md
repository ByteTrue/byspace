# Running BySpace in Docker

Docker support is an optional, self-managed way to run the daemon on a server,
VM, NAS, or homelab box. BySpace does not publish an official container image;
build `byspace:local` from this repository. The image also serves the bundled
browser web UI, so one container gives you both the daemon API and a self-hosted
UI.

The Docker source lives in [`docker/`](../docker/).

## How it works

The locally built image:

- builds `@bytetrue/byspace-server` and `@bytetrue/byspace` from source-built workspace tarballs
- runs the daemon as the non-root `byspace` user
- listens on `0.0.0.0:6777` inside the container
- enables the bundled daemon web UI with `BYSPACE_WEB_UI_ENABLED=true`
- stores daemon state and agent credentials under `/home/byspace`
- leaves agent CLIs out of the base image

Open the container's HTTP origin, for example `http://localhost:6777`, to load
the web UI. The served app receives a same-origin connection hint and connects
back to that daemon. Static UI files load without daemon auth; API and
WebSocket requests still require `BYSPACE_PASSWORD` when one is configured.

## Quick Start

From the repository root:

```bash
docker build -f docker/base/Dockerfile -t byspace:local .
docker run -d --name byspace \
  -p 6777:6777 \
  -e BYSPACE_PASSWORD=change-me \
  -v "$PWD/byspace-home:/home/byspace" \
  -v "$PWD:/workspace" \
  byspace:local
```

Then open:

```text
http://localhost:6777
```

If you set `BYSPACE_PASSWORD`, enter the same password when adding the direct
daemon connection in the web UI or another BySpace client.

## Docker Compose

Use [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml):

```bash
$EDITOR docker/docker-compose.example.yml
docker compose -f docker/docker-compose.example.yml up -d --build
```

Minimal example:

```yaml
services:
  byspace:
    build:
      context: ..
      dockerfile: docker/base/Dockerfile
    image: byspace:local
    restart: unless-stopped
    ports:
      - "6777:6777"
    environment:
      BYSPACE_PASSWORD: "change-me"
    volumes:
      - ../byspace-home:/home/byspace
      - ../workspace:/workspace
```

## Installing Agents

The local base image does not preinstall Claude Code, Codex, OpenCode, Copilot,
Pi, or other agent CLIs. That keeps the image small and avoids coupling the
BySpace source build to third-party agent release cycles.

Create a child image for the agents you use:

```Dockerfile
FROM byspace:local

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -f Dockerfile -t byspace-with-agents .
```

Then use `image: byspace-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to the
non-root `byspace` user.

An example child image is in
[`docker/Dockerfile.agents.example`](../docker/Dockerfile.agents.example).

You can also mount credentials from the host or run agent login once inside the
container:

```bash
docker exec -it --user byspace byspace codex
docker exec -it --user byspace byspace claude
```

Agent credentials and config persist in `/home/byspace`, alongside daemon state.
Provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, or `ANTHROPIC_BASE_URL` can be passed through `docker run -e`
or `compose.environment`; BySpace passes them to launched agents.

## Volumes

| Mount           | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `/home/byspace` | BySpace state under `.byspace` plus agent config such as `.codex`, `.claude` |
| `/workspace`    | Code that BySpace and launched agents can read and write                     |

The image defaults:

| Variable         | Default                  |
| ---------------- | ------------------------ |
| `HOME`           | `/home/byspace`          |
| `BYSPACE_HOME`   | `/home/byspace/.byspace` |
| `BYSPACE_LISTEN` | `0.0.0.0:6777`           |

If you bind-mount host directories on Linux, make sure the container user can
write them. The built-in `byspace` user has uid/gid `1000:1000`. For a different
host uid/gid, either adjust ownership on the mounted directories or run the
container with Docker's `--user` / Compose `user:` option.

## Reverse Proxies

When serving BySpace behind a reverse proxy, forward normal HTTP requests and
WebSocket upgrades to the same daemon port.

Caddy example:

```caddy
byspace.example.com {
  reverse_proxy 127.0.0.1:6777
}
```

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name byspace.example.com;

    location / {
        proxy_pass http://127.0.0.1:6777;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach the daemon by DNS name, set `BYSPACE_HOSTNAMES` so host-header
validation allows that name:

```yaml
environment:
  BYSPACE_HOSTNAMES: "byspace.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

- Set `BYSPACE_PASSWORD` for any published port or network-reachable deployment.
- Prefer HTTPS at the reverse proxy for direct browser access.
- Use the BySpace relay for untrusted networks or mobile access when you do not
  want to expose the daemon port directly.
- The container is the isolation boundary for agents. Agents can read and write
  whatever you mount into `/workspace` and whatever credentials you place in
  `/home/byspace`.
- The bundled web UI static files are public on the daemon origin. The daemon
  API and WebSocket remain protected by password auth when configured.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building Locally

```bash
docker build -f docker/base/Dockerfile -t byspace:local .
```

To assert the source tree version while building:

```bash
docker build \
  --build-arg BYSPACE_VERSION=0.2.0-beta.1 \
  -t byspace:local \
  -f docker/base/Dockerfile \
  .
```

## Troubleshooting

- **The web UI loads but cannot connect**: if `BYSPACE_PASSWORD` is set, add a
  direct connection with the same password.
- **403 Host not allowed**: set `BYSPACE_HOSTNAMES` to the DNS names you use.
- **Provider not available**: install that agent CLI in a child image or mount a
  runtime where the binary is on `PATH`.
- **Permission errors in `/workspace`**: make the mounted directory writable by
  uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs**: inspect `docker logs byspace` or
  `/home/byspace/.byspace/daemon.log` inside the container.
