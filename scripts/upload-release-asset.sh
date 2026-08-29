#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <release-tag> <asset-path>" >&2
  exit 2
fi

release_tag="$1"
asset_path="$2"
asset_name="$(basename "$asset_path")"

if gh release view "$release_tag" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name' | grep -Fxq "$asset_name"; then
  download_dir="$(mktemp -d)"
  trap 'rm -rf "$download_dir"' EXIT
  gh release download "$release_tag" --repo "$GITHUB_REPOSITORY" --pattern "$asset_name" --dir "$download_dir"
  if cmp -s "$asset_path" "$download_dir/$asset_name"; then
    echo "$asset_name already exists with identical bytes"
    exit 0
  fi
  echo "$asset_name already exists with different bytes; refusing to replace an immutable release asset" >&2
  exit 1
fi

gh release upload "$release_tag" "$asset_path" --repo "$GITHUB_REPOSITORY"
