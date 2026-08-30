#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export BYSPACE_LISTEN="${BYSPACE_LISTEN:-127.0.0.1:6778}"
configure_dev_paseo_home

if [ -z "${PASEO_LOCAL_MODELS_DIR}" ]; then
  export PASEO_LOCAL_MODELS_DIR="$HOME/.byspace/models/local-speech"
  mkdir -p "$PASEO_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  BySpace Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${BYSPACE_HOME}"
echo "  Models:  ${PASEO_LOCAL_MODELS_DIR}"
echo "  Listen:  ${BYSPACE_LISTEN}"
echo "══════════════════════════════════════════════════════"

export BYSPACE_CORS_ORIGINS="${BYSPACE_CORS_ORIGINS:-${PASEO_CORS_ORIGINS:-*}}"
export PASEO_NODE_INSPECT="${PASEO_NODE_INSPECT:---inspect=0}"

if [ "${PASEO_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
