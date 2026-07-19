# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG BYSPACE_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/byspace-src
COPY . .

RUN set -eux; \
    if [ -n "${BYSPACE_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${BYSPACE_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace-highlight --pack-destination /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace-relay --pack-destination /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace-protocol --pack-destination /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace-client --pack-destination /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace-server --pack-destination /tmp/byspace-packs; \
    npm pack --workspace=@bytetrue/byspace --pack-destination /tmp/byspace-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/byspace \
    BYSPACE_HOME=/home/byspace/.byspace \
    BYSPACE_LISTEN=0.0.0.0:6777 \
    BYSPACE_WEB_UI_ENABLED=true \
    BYSPACE_LOG_FORMAT=json \
    BYSPACE_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/byspace/.claude \
    CODEX_HOME=/home/byspace/.codex \
    XDG_CONFIG_HOME=/home/byspace/.config \
    XDG_DATA_HOME=/home/byspace/.local/share \
    XDG_STATE_HOME=/home/byspace/.local/state \
    XDG_CACHE_HOME=/home/byspace/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/byspace-packs /tmp/byspace-packs
RUN set -eux; \
	npm install -g /tmp/byspace-packs/*.tgz; \
    rm -rf /tmp/byspace-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@bytetrue/byspace-server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/byspace-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "byspace" ]; then \
      groupmod --new-name byspace "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 byspace; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "byspace" ]; then \
      usermod --login byspace --gid byspace --home /home/byspace --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid byspace --create-home --home-dir /home/byspace --shell /bin/bash byspace; \
    fi; \
    mkdir -p \
      /workspace \
      "$BYSPACE_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R byspace:byspace /home/byspace /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/byspace-docker-entrypoint

WORKDIR /workspace

EXPOSE 6777
VOLUME ["/home/byspace"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.BYSPACE_LISTEN||'0.0.0.0:6777'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6777; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/byspace-docker-entrypoint"]
