# BySpace CLI installer for Windows: irm https://app.byspace.cc.cd/install.ps1 | iex
#
# By default, this installs ONLY the standalone `byspace` CLI binary into $HOME\.local\bin.
# Desktop app installers are available on the GitHub Releases page, or by setting $env:BYSPACE_APP='1'.
#
# Environment overrides:
#   $env:BYSPACE_APP = '1'          # install Wails desktop GUI binary instead of CLI
#   $env:BYSPACE_PROXY = 'http://...' # proxy URL
#   $env:BYSPACE_MIRROR = 'https://...' # GitHub download mirror prefix
#   $env:BYSPACE_VERSION = 'v0.22.0'  # specific release tag (default: latest)
#   $env:BYSPACE_BIN_DIR = '...'      # install directory (default: $HOME\.local\bin)

$ErrorActionPreference = "Stop"
$repo = "ByteTrue/byspace"
$binDir = if ($env:BYSPACE_BIN_DIR) { $env:BYSPACE_BIN_DIR } else { Join-Path $HOME ".local\bin" }
$targetVersion = if ($env:BYSPACE_VERSION) { $env:BYSPACE_VERSION } else { "latest" }
$mirror = if ($env:BYSPACE_MIRROR) { $env:BYSPACE_MIRROR.TrimEnd("/") + "/" } else { "" }
$proxy = $env:BYSPACE_PROXY
$wantApp = ($env:BYSPACE_APP -eq "1") -or ($env:BYSPACE_DESKTOP -eq "1")

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { "arm64" }
  "AMD64" { "amd64" }
  default { throw "Unsupported Windows architecture: $($env:PROCESSOR_ARCHITECTURE)" }
}

$file = if ($wantApp) { "byspace-windows-$arch.exe" } else { "byspace-cli-windows-$arch.exe" }

$iwParams = @{ UseBasicParsing = $true }
if ($proxy) { $iwParams.Proxy = $proxy }

$ProgressPreference = "SilentlyContinue"
if ($targetVersion -eq "latest") {
  $req = [System.Net.HttpWebRequest]::Create("https://github.com/$repo/releases/latest")
  $req.AllowAutoRedirect = $false
  if ($proxy) { $req.Proxy = New-Object System.Net.WebProxy($proxy) }
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
  }
  $loc = if ($resp) { $resp.Headers["Location"] } else { $null }
  if ($resp) { $resp.Close() }
  if (-not $loc -or ($loc -notmatch "/tag/([^/?#]+)")) {
    throw "Could not resolve latest release tag from GitHub"
  }
  $tag = $Matches[1]
} elseif ($targetVersion.StartsWith('v')) {
  $tag = $targetVersion
} else {
  $tag = "v$targetVersion"
}
$version = $tag.TrimStart("v")

$sumsUrl = "https://github.com/$repo/releases/download/$tag/SHA256SUMS"
try {
  $sumsText = (Invoke-WebRequest -Uri $sumsUrl @iwParams).Content
} catch {
  $sumsText = (Invoke-WebRequest -Uri "$sumsUrl.txt" @iwParams).Content
}
if ($sumsText -is [byte[]]) { $sumsText = [System.Text.Encoding]::UTF8.GetString($sumsText) }

$expectedHash = $null
foreach ($line in ($sumsText -split "`r?`n")) {
  $parts = $line.Trim() -split '\s+'
  if ($parts.Length -ge 2) {
    $name = $parts[1].TrimStart("*")
    if ($name -eq $file) { $expectedHash = $parts[0].ToLowerInvariant(); break }
  }
}
if (-not $expectedHash -and $file -eq "byspace-cli-windows-$arch.exe") {
  $fallback = "byspace-windows-$arch.exe"
  foreach ($line in ($sumsText -split "`r?`n")) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Length -ge 2 -and $parts[1].TrimStart("*") -eq $fallback) {
      $file = $fallback
      $expectedHash = $parts[0].ToLowerInvariant()
      break
    }
  }
}
if (-not $expectedHash) { throw "Release $tag has no SHA256SUMS entry for $file" }

$downloadUrl = "${mirror}https://github.com/$repo/releases/download/$tag/$file"
Write-Host "  downloading byspace $version ($file)..."
$tmpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("byspace-" + [Guid]::NewGuid().ToString("N") + ".exe")
try {
  Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpFile @iwParams
  $actualHash = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "$file failed SHA-256 verification (got $actualHash, expected $expectedHash)"
  }
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $dest = Join-Path $binDir "byspace.exe"
  Move-Item -Force -Path $tmpFile -Destination $dest
} finally {
  if (Test-Path $tmpFile) { Remove-Item -Force $tmpFile -ErrorAction SilentlyContinue }
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($userPath -split ";" | Where-Object { $_ -eq $binDir })) {
  $newPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  $env:Path = "$env:Path;$binDir"
  Write-Host "  added $binDir to User PATH"
}
Write-Host "  installed $dest"
Write-Host "  run it: byspace --help"
