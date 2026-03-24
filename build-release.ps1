param(
  [string]$OutputRoot = "dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$manifestPath = Join-Path $repoRoot "manifest.json"

if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found."
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
  throw "manifest.json is missing a version."
}

$packageName = "study-focus-guard-v$version"
$outputRootPath = Join-Path $repoRoot $OutputRoot
$stagePath = Join-Path $outputRootPath $packageName
$zipPath = Join-Path $outputRootPath "$packageName.zip"

$filesToCopy = @(
  "manifest.json",
  "popup.html",
  "popup.js",
  "assets/styles/common.css",
  "assets/styles/popup.css",
  "assets/icons/icon16.png",
  "assets/icons/icon32.png",
  "assets/icons/icon48.png",
  "assets/icons/icon128.png",
  "background/rules-manager.js",
  "background/service-worker.js",
  "background/session-manager.js",
  "background/stats-manager.js",
  "background/unlock-manager.js",
  "pages/block.html",
  "pages/block.js",
  "pages/dashboard.html",
  "pages/dashboard.js",
  "pages/options.html",
  "pages/options.js",
  "pages/start-session.html",
  "pages/start-session.js",
  "pages/temp-allow-reminder.html",
  "pages/temp-allow-reminder.js",
  "pages/unlock.html",
  "pages/unlock.js",
  "shared/api.js",
  "shared/constants.js",
  "shared/domain.js",
  "shared/error-log.js",
  "shared/errors.js",
  "shared/session-secrets.js",
  "shared/storage.js",
  "shared/theme.js",
  "shared/time.js"
)

if (Test-Path $stagePath) {
  Remove-Item $stagePath -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $stagePath -Force | Out-Null

foreach ($relativePath in $filesToCopy) {
  $sourcePath = Join-Path $repoRoot $relativePath

  if (-not (Test-Path $sourcePath)) {
    throw "Missing required release file: $relativePath"
  }

  $destinationPath = Join-Path $stagePath $relativePath
  $destinationDir = Split-Path -Parent $destinationPath

  if ($destinationDir -and -not (Test-Path $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  Copy-Item $sourcePath $destinationPath -Force
}

Compress-Archive -Path $stagePath -DestinationPath $zipPath -Force

Write-Output "Release folder created: $stagePath"
Write-Output "Release zip created: $zipPath"
