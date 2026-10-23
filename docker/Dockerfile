# syntax=docker/dockerfile:1

# BySpace self-hosted edge: one container serving the static web export and
# the E2EE relay on the same origin (one domain, one certificate, one port).
# Both come out of the single `byspace` binary; the daemon is NOT included —
# it runs on your own machine.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG GO_IMAGE=golang:1.27-bookworm

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web

ARG BYSPACE_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/byspace-src

# Manifests first so the `npm ci` layer survives source-only changes (issue 027).
COPY package.json package-lock.json ./
COPY packages/highlight/package.json packages/highlight/
COPY packages/protocol/package.json packages/protocol/
COPY packages/client/package.json packages/client/
COPY packages/app/package.json packages/app/
COPY packages/relay/package.json packages/relay/

RUN set -eux; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

COPY . .

# COPY restored the original package.json (with its prepare and postinstall
# hooks). Strip both again: the build must not run lefthook, and the
# patch-package postinstall only patches app-only react-native deps.
RUN node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'

RUN set -eux; \
    if [ -n "${BYSPACE_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${BYSPACE_VERSION}"; \
    fi; \
    npm run build:daemon-web-ui; \
    test -f internal/webui/dist/index.html; \
    test -f internal/webui/dist/schemas/byspace.config.v1.json; \
    test -f internal/webui/dist/docs/index.html; \
    test -f internal/webui/dist/changelog.html

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS binary

# Re-declared per stage: ARG does not cross FROM boundaries.
ARG BYSPACE_VERSION
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# The web assets are generated, not committed: take them from the npm stage.
COPY --from=web /tmp/byspace-src/internal/webui/dist ./internal/webui/dist
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
      go build -trimpath -ldflags "-s -w -X main.version=${BYSPACE_VERSION}" \
      -o /out/byspace ./cmd/byspace

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/ByteTrue/byspace"

COPY --from=binary /out/byspace /usr/local/bin/byspace

# The web export is embedded in the binary at build time (internal/webui/dist);
# the relay and web UI are stateless, so nothing else goes into the image.
USER nonroot:nonroot

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/byspace", "healthcheck", "--url", "http://127.0.0.1:8080"]

CMD ["/usr/local/bin/byspace", "relay", "--addr", "0.0.0.0:8080"]
