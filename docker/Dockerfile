# syntax=docker/dockerfile:1

# BySpace self-hosted edge: one container serving the static web export and
# the Node relay on the same origin (one domain, one certificate, one port).
# The daemon is NOT included - it runs on your own machine via npm.

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build

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
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/

RUN set -eux; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

COPY . .

# COPY restored the original package.json (with its prepare and postinstall
# hooks). Strip both again: `npm pack` must not run lefthook, and the
# patch-package postinstall only patches app-only react-native deps that
# never enter this image.
RUN node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; delete pkg.scripts.postinstall; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'

RUN set -eux; \
    if [ -n "${BYSPACE_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${BYSPACE_VERSION}"; \
    fi; \
    npm run build:web --workspace=@bytetrue/app; \
    test -f packages/app/dist/index.html; \
    test -f packages/app/dist/schemas/byspace.config.v1.json; \
    mkdir -p /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/relay --pack-destination /tmp/byspace-packs

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/ByteTrue/byspace"

COPY --from=build /tmp/byspace-packs /tmp/byspace-packs
RUN set -eux; \
    npm install -g /tmp/byspace-packs/*.tgz; \
    rm -rf /tmp/byspace-packs; \
    npm cache clean --force; \
    test -f /usr/local/lib/node_modules/@bytetrue/relay/dist/node-main.js; \
    node --check /usr/local/lib/node_modules/@bytetrue/relay/dist/node-main.js

COPY --from=build /tmp/byspace-src/packages/app/dist /opt/byspace/web
ENV BYSPACE_WEB_DIR=/opt/byspace/web

# The relay and web UI are stateless: sessions live in memory only.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=Number(process.env.BYSPACE_RELAY_PORT||process.env.PORT||8080); require('http').get({hostname:'127.0.0.1',port,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/usr/local/lib/node_modules/@bytetrue/relay/dist/node-main.js"]