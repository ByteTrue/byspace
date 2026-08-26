# Android development and sideload builds

BySpace's Android client is generated from the shared Expo app in
`packages/app`. The generated `packages/app/android/` directory is ignored and
must not become a second source of truth.

## Current delivery boundary

Epic 005 restored Android for local development and internally verified sideloaded
artifacts. Google Play publishing and a production signing key remain outside the
current release gate.

Permanent identifiers are:

- production application ID: `com.bytetrue.byspace`
- development application ID: `com.bytetrue.byspace.debug`
- URL scheme: `byspace`

Do not change these identifiers when product domains change. Once an app is
distributed, changing its application ID creates a different Android app and a
different storage sandbox.

## Toolchain

The repository pins Java and Android command-line tools in `.tool-versions` and
`.mise.toml`. Use Node.js 22 or newer from the user's global installation; do not
add a repository-local Node pin because it would split global BySpace CLI and
daemon installs across Node versions.

```bash
mise trust
mise install
```

For a new machine, accept the Android SDK licenses and install the packages
used by Expo SDK 54 / React Native 0.81:

```bash
yes | mise exec -- sdkmanager --licenses
mise exec -- sdkmanager \
  platform-tools \
  emulator \
  'platforms;android-36' \
  'build-tools;36.0.0' \
  'ndk;27.0.12077973' \
  'ndk;27.1.12297006' \
  'cmake;3.22.1' \
  'system-images;android-35;google_apis_playstore;arm64-v8a'
```

The generated project currently targets SDK 36, has a minimum SDK of 29, and
uses Java 21. The root React Native build uses NDK 27.1; the generated
`react-native-unistyles` library also resolves the Android Gradle Plugin's NDK
27.0 default. Installing both prevents Gradle from provisioning one during the
first artifact build.

## Generate and build

Start from a clean dependency install so workspace declarations and the local
Expo audio module are current:

```bash
mise exec -- npm ci
mise exec -- npm run build:app-deps
cd packages/app
mise exec -- env CI=1 NODE_ENV=production APP_VARIANT=production npx expo prebuild --platform android --clean
cd android
mise exec -- env NODE_ENV=production ./gradlew :app:assembleRelease --no-daemon --max-workers=2 -Dorg.gradle.parallel=false
```

The APK is generated at:

```text
packages/app/android/app/build/outputs/apk/release/app-release.apk
```

This `release` variant is intentionally signed with the generated Android debug
keystore. It is suitable for internal sideload testing only; it is not a Play
Store artifact. Production signing is a later delivery gate.

For an attached emulator or device, the app package also exposes the upstream
run commands:

```bash
npm run android:development --workspace=@bytetrue/byspace-app
npm run android:production --workspace=@bytetrue/byspace-app
```

Both commands rebuild the complete App dependency stack before running Expo.

Remove the generated native project with:

```bash
npm run android:clear --workspace=@bytetrue/byspace-app
```

## Emulator

Create the project AVD once:

```bash
printf 'no\n' | mise exec -- avdmanager create avd \
  --name byspace-api35-arm64 \
  --package 'system-images;android-35;google_apis_playstore;arm64-v8a' \
  --device pixel_7
```

Start it headlessly when a graphical emulator is unnecessary:

```bash
mise exec -- emulator -avd byspace-api35-arm64 \
  -no-window -no-audio -no-boot-anim -no-snapshot
```

Install or replace the sideload artifact:

```bash
mise exec -- adb install -r \
  packages/app/android/app/build/outputs/apk/release/app-release.apk
```

Android emulators reach a daemon on the host through `10.0.2.2`. For a smoke
test that should preserve the client's normal `localhost:6777` bootstrap, map
the device port to an isolated host daemon instead:

```bash
mise exec -- adb reverse tcp:6777 tcp:6769
```

Relay pairing can be tested without emulator camera input by opening the
`byspace` deep link containing the daemon offer. Always use an isolated daemon
home for this test; never restart the main daemon on port 6777.
