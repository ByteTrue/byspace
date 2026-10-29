#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo dev)}"
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/share/mise/installs/android-sdk/21.0}}"
if [ ! -d "$ANDROID_SDK" ]; then
  echo "error: ANDROID_HOME not found at $ANDROID_SDK" >&2
  exit 1
fi
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

if [ -z "${JAVA_HOME:-}" ] && [ -d "/opt/homebrew/opt/openjdk@21" ]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

NDK_DIR="${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_SDK"/ndk/* 2>/dev/null | sort -V | tail -n 1)}"
if [ -z "$NDK_DIR" ] || [ ! -d "$NDK_DIR" ]; then
  echo "error: Android NDK not found under $ANDROID_SDK/ndk" >&2
  exit 1
fi

TOOLCHAIN_BIN="$(ls -d "$NDK_DIR"/toolchains/llvm/prebuilt/*/bin 2>/dev/null | head -n 1)"
CC_ARM64="$TOOLCHAIN_BIN/aarch64-linux-android24-clang"
CXX_ARM64="$TOOLCHAIN_BIN/aarch64-linux-android24-clang++"
if [ ! -x "$CC_ARM64" ]; then
  echo "error: clang toolchain not found at $CC_ARM64" >&2
  exit 1
fi

JNILIBS_ARM64="$ROOT_DIR/build/android/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$JNILIBS_ARM64" "$ROOT_DIR/bin"

echo "● Building libwails.so (android/arm64, version=$VERSION)..."
unset CGO_CFLAGS CGO_LDFLAGS
CGO_ENABLED=1 \
GOOS=android \
GOARCH=arm64 \
CC="$CC_ARM64" \
CXX="$CXX_ARM64" \
go build \
  -buildmode=c-shared \
  -trimpath \
  -ldflags="-s -w -X main.version=$VERSION" \
  -o "$JNILIBS_ARM64/libwails.so" \
  .

rm -f "$JNILIBS_ARM64/libwails.h"

echo "● Assembling Android APK via Gradle..."
(
  cd "$ROOT_DIR/build/android"
  ./gradlew assembleRelease --no-daemon -Pandroid.injected.abi=arm64-v8a
)

APK_SRC="$ROOT_DIR/build/android/app/build/outputs/apk/release/app-release.apk"
APK_DST="$ROOT_DIR/bin/byspace-android-arm64.apk"
cp "$APK_SRC" "$APK_DST"
echo "● Built Android APK: $APK_DST ($(du -h "$APK_DST" | cut -f1))"
