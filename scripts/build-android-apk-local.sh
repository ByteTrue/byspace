#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

[[ -z "$(git status --porcelain)" ]] || {
  echo "Android release builds require a clean worktree" >&2
  exit 1
}

git fetch origin main --no-tags
sha="$(git rev-parse HEAD)"
[[ "$sha" == "$(git rev-parse origin/main)" ]] || {
  echo "HEAD must match origin/main" >&2
  exit 1
}

repo="${GITHUB_REPOSITORY:-ByteTrue/byspace}"
ci_run="$(gh run list --repo "$repo" --workflow CI --commit "$sha" --event push --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
[[ -n "$ci_run" ]] || {
  echo "No successful CI push run found for $sha" >&2
  exit 1
}

secrets_dir="${BYSPACE_RELEASE_SECRETS_DIR:-$HOME/.config/byspace/release-secrets}"
env_file="$secrets_dir/android-release-v1.env"
if [[ -f "$env_file" ]]; then
  set -a
  source "$env_file"
  set +a
fi
keystore="${ANDROID_RELEASE_KEYSTORE:-$secrets_dir/android-release-v1.jks}"
for name in ANDROID_RELEASE_KEYSTORE_PASSWORD ANDROID_RELEASE_KEY_ALIAS ANDROID_RELEASE_KEY_PASSWORD; do
  [[ -n "${!name:-}" ]] || {
    echo "Missing $name" >&2
    exit 1
  }
done
[[ -f "$keystore" ]] || {
  echo "Keystore not found: $keystore" >&2
  exit 1
}
: "${ANDROID_HOME:?ANDROID_HOME must point to the installed Android SDK}"
command -v apkanalyzer >/dev/null || {
  echo "apkanalyzer is not on PATH" >&2
  exit 1
}

app="$root/packages/app"
[[ ! -e "$app/credentials.json" && ! -e "$app/.eas-secrets" ]] || {
  echo "Refusing to replace existing local EAS credentials" >&2
  exit 1
}

build_tmp="$(mktemp -d "${TMPDIR:-/tmp}/byspace-android-release.XXXXXX")"
cleanup() {
  rm -rf "$app/credentials.json" "$app/.eas-secrets" "$build_tmp"
}
trap cleanup EXIT

mkdir -m 700 "$app/.eas-secrets"
cp "$keystore" "$app/.eas-secrets/byspace-android-release.jks"
chmod 600 "$app/.eas-secrets/byspace-android-release.jks"
APP_DIR="$app" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(
  path.join(process.env.APP_DIR, "credentials.json"),
  `${JSON.stringify({
    android: {
      keystore: {
        keystorePath: ".eas-secrets/byspace-android-release.jks",
        keystorePassword: process.env.ANDROID_RELEASE_KEYSTORE_PASSWORD,
        keyAlias: process.env.ANDROID_RELEASE_KEY_ALIAS,
        keyPassword: process.env.ANDROID_RELEASE_KEY_PASSWORD,
      },
    },
  })}\n`,
  { mode: 0o600 },
);
NODE

version="$(node -p 'require("./package.json").version')"
output_dir="$root/dist/android"
asset="$output_dir/BySpace-$version-android.apk"
[[ ! -e "$asset" && ! -e "$asset.sha256" ]] || {
  echo "Release artifact already exists: $asset" >&2
  exit 1
}
mkdir -p "$output_dir"

(
  cd "$app"
  TMPDIR="$build_tmp" \
    CI=1 \
    EXPO_NO_DOTENV=1 \
    NODE_ENV=production \
    npx eas build --local --platform android --profile production-apk \
      --freeze-credentials --non-interactive --output "$asset"
)

build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
apksigner="$build_tools/apksigner"
[[ -x "$apksigner" ]] || {
  echo "apksigner not found under ANDROID_HOME=$ANDROID_HOME" >&2
  exit 1
}
"$apksigner" verify --verbose --print-certs "$asset" | tee "$build_tmp/apksigner.txt"
fingerprint="$(node scripts/apksigner-certificate-sha256.mjs "$build_tmp/apksigner.txt")"
expected_fingerprint="$(node -p 'require("./.github/release/android-signing.json").certificateSha256.toLowerCase()')"
[[ "$fingerprint" == "$expected_fingerprint" ]]
[[ "$(apkanalyzer manifest application-id "$asset")" == "com.bytetrue.byspace" ]]
native_version="$(node -p 'require("./packages/app/native-release-version.js").getNativeReleaseVersion(require("./package.json").version).appVersion')"
[[ "$(apkanalyzer manifest version-name "$asset")" == "$native_version" ]]

apk_entries="$(unzip -Z1 "$asset")"
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  grep -q "^lib/$abi/" <<<"$apk_entries" || {
    echo "APK is missing native ABI: $abi" >&2
    exit 1
  }
done

node scripts/write-sha256.mjs "$asset"
printf 'Android release artifact: %s\nSource commit: %s\nCI run: %s\n' "$asset" "$sha" "$ci_run"
