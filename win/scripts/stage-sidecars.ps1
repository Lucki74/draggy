# Copies the pinned node.exe into src-tauri/binaries under the target-triple name Tauri's externalBin expects.
# Runs at build time only; the app never downloads node. Fails when the vendored file does not match the pin.
param([string]$Source = (Join-Path $PSScriptRoot '..\vendor\node\node.exe'))
$ErrorActionPreference = 'Stop'
# tauri build can start pwsh with a PSModulePath that does not autoload the core modules.
Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility -ErrorAction Stop
$pin = Get-Content -Raw (Join-Path $PSScriptRoot 'node-pin.json') | ConvertFrom-Json
if (-not (Test-Path $Source)) { throw "Pinned node.exe missing at $Source (expected $($pin.version))" }
# Hashed in .NET, not Get-FileHash, so the check does not depend on module autoload.
$sha = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Source).Path)
try { $hash = ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha.Dispose() }
if ($hash -ne $pin.sha256) { throw "node.exe sha256 $hash does not match pin $($pin.version) $($pin.sha256)" }
$dir = Join-Path $PSScriptRoot '..\src-tauri\binaries'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -LiteralPath $Source -Destination (Join-Path $dir 'node-x86_64-pc-windows-msvc.exe') -Force
Write-Output "staged node $($pin.version)"
