#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../");
const artifactRoot = resolve(
  process.env.BYSPACE_TUNNEL_ARTIFACT_DIR ?? join(root, "artifacts/native/darwin-arm64"),
);
const args = process.argv.slice(2);

if (args.length !== 1 || args[0] !== "--install") {
  throw new Error("usage: node install.mjs --install");
}
if (platform() !== "darwin" || arch() !== "arm64") {
  throw new Error("the first helper installer target is macOS arm64");
}
if (typeof process.getuid !== "function" || process.getuid() === 0) {
  throw new Error("run the installer as the daemon owner, not as root");
}

const ownerUid = process.getuid();
const helper = join(artifactRoot, "byspace-tunnel-helper");
const supervisor = join(artifactRoot, "byspace-tunnel-supervisor");
const manifest = join(artifactRoot, "manifest.json");
const label = `com.bytetrue.byspace.remote-tunnel.${ownerUid}`;
const socketPath = `/var/run/byspace-tunnel-${ownerUid}.sock`;
const installRoot = "/Library/PrivilegedHelperTools";
const daemonRoot = "/Library/LaunchDaemons";
const installedHelper = `${installRoot}/byspace-tunnel-helper`;
const installedSupervisor = `${installRoot}/byspace-tunnel-supervisor`;
const plistPath = `${daemonRoot}/${label}.plist`;

if ([installedHelper, installedSupervisor, plistPath].some((path) => existsSync(path))) {
  throw new Error(
    "Remote Tunnel is already or partially installed; --install is initial-install only, and upgrades must use the trusted passwordless product path",
  );
}

const manifestData = JSON.parse(readFileSync(manifest, "utf8"));
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
if (manifestData.sha256 !== sha256File(helper)) {
  throw new Error("helper digest does not match manifest");
}
if (manifestData.supervisorSha256 !== sha256File(supervisor)) {
  throw new Error("supervisor digest does not match manifest");
}
execFileSync("/usr/bin/codesign", ["--verify", "--strict", helper], { stdio: "inherit" });
execFileSync("/usr/bin/codesign", ["--verify", "--strict", supervisor], { stdio: "inherit" });

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${installedSupervisor}</string>
    <string>--owner-uid</string>
    <string>${ownerUid}</string>
    <string>--socket</string>
    <string>${socketPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>/var/log/byspace-remote-tunnel-${ownerUid}.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/byspace-remote-tunnel-${ownerUid}.log</string>
</dict>
</plist>
`;

const installScript = `#!/bin/sh
set -eu
artifact_root=$1
installed_helper=$2
installed_supervisor=$3
plist_path=$4
label=$5
helper_sha=$6
supervisor_sha=$7
plist_base64=$8

install_lock="/var/run/$label.install.lock"
stage=
helper_new="$installed_helper.new.$$"
supervisor_new="$installed_supervisor.new.$$"
plist_new="$plist_path.new.$$"
success=0
published=0

if ! /bin/mkdir "$install_lock"; then
  echo 'Remote Tunnel installation is already running' >&2
  exit 75
fi

cleanup() {
  status=$?
  trap - EXIT
  /bin/rm -f "$helper_new" "$supervisor_new" "$plist_new"
  if [ "$success" -ne 1 ] && [ "$published" -eq 1 ]; then
    /bin/launchctl bootout system/"$label" 2>/dev/null || true
    /bin/rm -f "$installed_helper" "$installed_supervisor" "$plist_path"
  fi
  if [ -n "$stage" ]; then
    /bin/rm -rf "$stage"
  fi
  /bin/rmdir "$install_lock" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ -e "$installed_helper" ] || [ -e "$installed_supervisor" ] || [ -e "$plist_path" ] || /bin/launchctl print system/"$label" >/dev/null 2>&1; then
  echo 'Remote Tunnel is already or partially installed; refusing a second authorization path' >&2
  exit 73
fi

stage=$(/usr/bin/mktemp -d /private/tmp/byspace-tunnel-install.root.XXXXXX)
/bin/chmod 700 "$stage"
helper_stage="$stage/byspace-tunnel-helper"
supervisor_stage="$stage/byspace-tunnel-supervisor"
plist_stage="$stage/$label.plist"

/usr/bin/install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools
/usr/bin/install -d -o root -g wheel -m 755 /Library/LaunchDaemons
/usr/bin/install -o root -g wheel -m 755 "$artifact_root/byspace-tunnel-helper" "$helper_stage"
/usr/bin/install -o root -g wheel -m 755 "$artifact_root/byspace-tunnel-supervisor" "$supervisor_stage"
/usr/bin/printf '%s' "$plist_base64" | /usr/bin/base64 -D > "$plist_stage"
/usr/sbin/chown root:wheel "$plist_stage"
/bin/chmod 644 "$plist_stage"

actual_helper_sha=$(/usr/bin/shasum -a 256 "$helper_stage" | /usr/bin/awk '{print $1}')
actual_supervisor_sha=$(/usr/bin/shasum -a 256 "$supervisor_stage" | /usr/bin/awk '{print $1}')
if [ "$actual_helper_sha" != "$helper_sha" ] || [ "$actual_supervisor_sha" != "$supervisor_sha" ]; then
  echo 'Remote Tunnel artifact changed during authorization' >&2
  exit 65
fi
/usr/bin/codesign --verify --strict "$helper_stage"
/usr/bin/codesign --verify --strict "$supervisor_stage"
/usr/bin/plutil -lint "$plist_stage" >/dev/null

/usr/bin/install -o root -g wheel -m 755 "$helper_stage" "$helper_new"
/usr/bin/install -o root -g wheel -m 755 "$supervisor_stage" "$supervisor_new"
/usr/bin/install -o root -g wheel -m 644 "$plist_stage" "$plist_new"
published=1
/bin/mv -f "$helper_new" "$installed_helper"
/bin/mv -f "$supervisor_new" "$installed_supervisor"
/bin/mv -f "$plist_new" "$plist_path"
/bin/launchctl bootstrap system "$plist_path"
/bin/launchctl kickstart -k system/"$label"
/bin/launchctl print system/"$label" >/dev/null
success=1
`;

const encodedScript = Buffer.from(installScript).toString("base64");
const encodedPlist = Buffer.from(plist).toString("base64");
const commandArguments = [
  artifactRoot,
  installedHelper,
  installedSupervisor,
  plistPath,
  label,
  manifestData.sha256,
  manifestData.supervisorSha256,
  encodedPlist,
].map(shellQuote);
const command = [
  "/usr/bin/printf '%s'",
  shellQuote(encodedScript),
  "| /usr/bin/base64 -D | /bin/sh -s --",
  ...commandArguments,
].join(" ");

execFileSync(
  "/usr/bin/osascript",
  ["-e", `do shell script ${JSON.stringify(command)} with administrator privileges`],
  {
    stdio: "inherit",
  },
);

process.stdout.write(`installed ${label}; runtime socket ${socketPath}\n`);
