# syntax=docker/dockerfile:1

# Self-hosted BySpace web: static export of packages/app served by nginx.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:stable-alpine
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS app-build

ARG BYSPACE_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/byspace-src

# Manifests first so `npm ci` layer survives source-only changes (issue 027).
COPY package.json package-lock.json ./
COPY packages/highlight/package.json packages/highlight/
COPY packages/protocol/package.json packages/protocol/
COPY packages/client/package.json packages/client/
COPY packages/app/package.json packages/app/
COPY packages/relay/package.json packages/relay/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/

RUN set -eux; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

COPY . .

# COPY restored the original package.json (with its prepare and postinstall
# hooks). Strip both again before building.
RUN node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'

RUN set -eux; \
    if [ -n "${BYSPACE_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${BYSPACE_VERSION}"; \
    fi; \
    npm run build:web --workspace=@bytetrue/app; \
    test -f packages/app/dist/index.html; \
    test -f packages/app/dist/schemas/byspace.config.v1.json

FROM ${NGINX_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/ByteTrue/byspace"

COPY docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app-build /tmp/byspace-src/packages/app/dist /usr/share/nginx/html

EXPOSE 8080
