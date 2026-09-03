#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export BYSPACE_LISTEN="${BYSPACE_LISTEN:-127.0.0.1:6778}"
configure_dev_byspace_home

LOCAL_MODELS_DIR="${BYSPACE_LOCAL_MODELS_DIR:-${PASEO_LOCAL_MODELS_DIR:-$HOME/.byspace/models/local-speech}}"
export BYSPACE_LOCAL_MODELS_DIR="$LOCAL_MODELS_DIR"
export PASEO_LOCAL_MODELS_DIR="$LOCAL_MODELS_DIR"
mkdir -p "$LOCAL_MODELS_DIR"

echo "══════════════════════════════════════════════════════"
echo "  BySpace Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${BYSPACE_HOME}"
echo "  Models:  ${LOCAL_MODELS_DIR}"
echo "  Listen:  ${BYSPACE_LISTEN}"
echo "══════════════════════════════════════════════════════"

export BYSPACE_CORS_ORIGINS="${BYSPACE_CORS_ORIGINS:-${PASEO_CORS_ORIGINS:-*}}"
export PASEO_NODE_INSPECT="${PASEO_NODE_INSPECT:---inspect=0}"

SKIP_BUILD="${BYSPACE_SKIP_DEV_SERVER_BUILD:-${PASEO_SKIP_DEV_SERVER_BUILD:-0}}"
if [ "$SKIP_BUILD" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
