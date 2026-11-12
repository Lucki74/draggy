# Copies the pinned node.exe into src-tauri/binaries under the target-triple name Tauri's externalBin expects.
# Runs at build time only; the app never downloads node. Fails when the vendored file does not match the pin.
param([string]$Source = (Join-Path $PSScriptRoot '..\vendor\node\node.exe'))
$ErrorActionPreference = 'Stop'
$pin = Get-Content -Raw (Join-Path $PSScriptRoot 'node-pin.json') | ConvertFrom-Json
if (-not (Test-Path $Source)) { throw "Pinned node.exe missing at $Source (expected $($pin.version))" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Source).Hash.ToLowerInvariant()
if ($hash -ne $pin.sha256) { throw "node.exe sha256 $hash does not match pin $($pin.version) $($pin.sha256)" }
$dir = Join-Path $PSScriptRoot '..\src-tauri\binaries'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -LiteralPath $Source -Destination (Join-Path $dir 'node-x86_64-pc-windows-msvc.exe') -Force
Write-Output "staged node $($pin.version)"
