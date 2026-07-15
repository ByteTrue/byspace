#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export BYSPACE_LISTEN="${BYSPACE_LISTEN:-127.0.0.1:6768}"
configure_dev_paseo_home

if [ -z "${BYSPACE_LOCAL_MODELS_DIR}" ]; then
  export BYSPACE_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech"
  mkdir -p "$BYSPACE_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Paseo Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${BYSPACE_HOME}"
echo "  Models:  ${BYSPACE_LOCAL_MODELS_DIR}"
echo "  Listen:  ${BYSPACE_LISTEN}"
echo "══════════════════════════════════════════════════════"

export BYSPACE_CORS_ORIGINS="${BYSPACE_CORS_ORIGINS:-*}"
export BYSPACE_NODE_INSPECT="${BYSPACE_NODE_INSPECT:---inspect=0}"

if [ "${BYSPACE_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
