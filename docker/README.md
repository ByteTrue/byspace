# Self-hosted BySpace container

The published container is one image, `ghcr.io/bytetrue/byspace`, that serves
the static web UI and the relay from the same port. The daemon is **not**
included — it runs on your own machine, installed via npm.

```bash
docker compose up -d          # web + relay, HTTP on :8080
```

For TLS (one domain covers both the web UI and the relay WebSocket), see the
`tls` profile in [docs/docker.md](../docs/docker.md). That doc also covers
version pinning, connecting your daemon, and the plain-HTTP tradeoffs.

Want the daemon in a container instead? Install the npm package in your own image:

```Dockerfile
FROM node:22
RUN npm install -g @bytetrue/byspace
EXPOSE 6777
CMD ["byspace", "daemon", "start"]
```

The image is built by [.github/workflows/docker.yml](../.github/workflows/docker.yml),
multi-arch (amd64/arm64), published on release tags.
