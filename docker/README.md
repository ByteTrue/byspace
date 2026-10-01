# Self-hosted BySpace containers

The published containers are two small images:

- `ghcr.io/bytetrue/byspace-web` — static web UI behind nginx (unprivileged). The daemon is **not** included; it runs on your own machine, installed via npm.
- `ghcr.io/bytetrue/byspace-relay` — the relay as a Node service, for users who want to self-host the relay instead of using the hosted one.

Start the stack:

```bash
docker compose up -d                                  # web only, HTTP on :8080
docker compose --profile relay up -d                   # + self-hosted relay on :8081
```

See [docs/docker.md](../docs/docker.md) for TLS (caddy profile), version pinning,
connecting your daemon, and the HTTP-secure-context tradeoffs.

Want the daemon in a container instead? Install the npm package in your own image:

```Dockerfile
FROM node:22
RUN npm install -g @bytetrue/byspace
EXPOSE 6777
CMD ["byspace", "daemon", "start"]
```

Container images are built by [.github/workflows/docker.yml](../.github/workflows/docker.yml),
multi-arch (amd64/arm64), published on release tags.
