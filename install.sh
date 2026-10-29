#!/bin/sh
# BySpace CLI installer: curl -fsSL https://app.byspace.cc.cd/install.sh | sh
#
# By default on every platform (macOS, Linux, Android Termux), this installs ONLY the
# standalone `byspace` CLI binary into ~/.local/bin (or $PREFIX/bin on Termux).
# Desktop app installers (.dmg, .exe, Linux desktop binary, Android .apk) are available on
# the GitHub Releases page, or by passing --app.
#
# Options (curl -fsSL https://app.byspace.cc.cd/install.sh | sh -s -- --proxy ...):
#   --app, --desktop   install the Wails desktop app instead of the standalone CLI (or BYSPACE_APP=1)
#   --proxy <url>      http://, https://, socks5:// or socks5h:// proxy (or BYSPACE_PROXY=)
#   --mirror <prefix>  GitHub download mirror prefix put before github.com URLs (or BYSPACE_MIRROR=)
#   --version <tag>    specific version/tag to install (default: latest)
set -eu

repo="ByteTrue/byspace"
github_url="${BYSPACE_GITHUB_URL:-https://github.com}"
bin="${BYSPACE_BIN_DIR:-$HOME/.local/bin}"
want_app="${BYSPACE_APP:-${BYSPACE_DESKTOP:-}}"
proxy="${BYSPACE_PROXY:-}"
mirror="${BYSPACE_MIRROR:-}"
target_version="${BYSPACE_VERSION:-latest}"

say() { printf '  %s\n' "$*"; }
die() { printf 'byspace: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --cli) want_app=; shift ;;
    --app|--desktop) want_app=1; shift ;;
    --proxy) [ $# -ge 2 ] || die "--proxy needs a value"; proxy=$2; shift 2 ;;
    --proxy=*) proxy=${1#--proxy=}; shift ;;
    --mirror) [ $# -ge 2 ] || die "--mirror needs a value"; mirror=$2; shift 2 ;;
    --mirror=*) mirror=${1#--mirror=}; shift ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; target_version=$2; shift 2 ;;
    --version=*) target_version=${1#--version=}; shift ;;
    -h|--help)
      printf '%s\n' "usage: curl -fsSL https://app.byspace.cc.cd/install.sh | sh -s -- [--app] [--proxy <url>] [--mirror <prefix>] [--version <tag>]"
      exit 0 ;;
    *) die "unknown option $1 (--app, --proxy <url>, --mirror <prefix>, --version <tag>)" ;;
  esac
done

case "$proxy" in
  ''|http://?*|https://?*|socks5://?*|socks5h://?*) ;;
  *) die "--proxy must be http://, https://, socks5:// or socks5h://, not $proxy" ;;
esac
case "$mirror" in
  '') ;;
  http://?*|https://?*) case "$mirror" in */) ;; *) mirror="$mirror/" ;; esac ;;
  *) die "--mirror must be an http(s) prefix put before github.com URLs, like https://mirror.example/, not $mirror" ;;
esac

get() {
  if [ -n "$proxy" ]; then curl -fsSL --proxy "$proxy" "$@"; else curl -fsSL "$@"; fi
}

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=amd64 ;;
  *) die "unsupported CPU architecture: $(uname -m)" ;;
esac

case "$(uname -s)" in
  Darwin)
    os=darwin
    if [ -n "$want_app" ]; then file="byspace-darwin-$arch.zip"; else file="byspace-cli-darwin-$arch"; fi ;;
  Linux)
    termux="${TERMUX_VERSION:-}"
    case "${PREFIX:-}" in */com.termux/files/usr) termux=1 ;; esac
    if [ -n "$termux" ]; then
      [ -n "${PREFIX:-}" ] || die "Termux requires PREFIX to locate its bin directory"
      os=android; file="byspace-cli-android-$arch"
      bin="${BYSPACE_BIN_DIR:-$PREFIX/bin}"
    else
      os=linux
      if [ -n "$want_app" ]; then file="byspace-linux-$arch"; else file="byspace-cli-linux-$arch"; fi
    fi ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ "$target_version" = "latest" ]; then
  loc=$(get -I "$github_url/$repo/releases/latest" | tr -d '\r' | sed -n 's/^[Ll]ocation: .*\/tag\///p' | tail -n 1)
  [ -n "$loc" ] || die "could not resolve latest release tag from GitHub"
  tag="$loc"
else
  case "$target_version" in v*) tag="$target_version" ;; *) tag="v$target_version" ;; esac
fi
version="${tag#v}"

sums_url="$github_url/$repo/releases/download/$tag/SHA256SUMS"
sums=$(get "$sums_url" 2>/dev/null || get "${sums_url}.txt" 2>/dev/null) || die "could not fetch SHA256SUMS for $tag"

sum=$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f || $2 == "*"f { print tolower($1); exit }')
if [ -z "$sum" ] && [ "$file" = "byspace-cli-$os-$arch" ]; then
  file="byspace-$os-$arch"
  sum=$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f || $2 == "*"f { print tolower($1); exit }')
fi
[ -n "$sum" ] || die "release $tag has no checksum entry for $file"

url="$github_url/$repo/releases/download/$tag/$file"
from="${mirror}${url}"
say "downloading byspace $version ($file)..."
get -o "$tmp/$file" "$from" || die "could not download $from"

if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp/$file" | awk '{print tolower($1)}')
else
  got=$(shasum -a 256 "$tmp/$file" | awk '{print tolower($1)}')
fi
[ "$got" = "$sum" ] || die "$file failed SHA-256 verification (got $got, expected $sum)"

mkdir -p "$bin"
case "$file" in
  *.zip)
    apps="${BYSPACE_APPS_DIR:-/Applications}"
    [ -w "$apps" ] || { apps="$HOME/Applications"; mkdir -p "$apps"; }
    ditto -x -k "$tmp/$file" "$tmp/x"
    rm -rf "$apps/.BySpace.app.new"
    mv "$tmp/x/BySpace.app" "$apps/.BySpace.app.new"
    rm -rf "$apps/BySpace.app"
    mv "$apps/.BySpace.app.new" "$apps/BySpace.app"
    ln -sf "$apps/BySpace.app/Contents/MacOS/byspace" "$bin/byspace"
    say "installed $apps/BySpace.app"
    ;;
  *)
    install -m 755 "$tmp/$file" "$bin/byspace"
    ;;
esac

say "installed $bin/byspace"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) say "add $bin to your PATH to run byspace from any terminal" ;;
esac
say "run it: byspace --help"
