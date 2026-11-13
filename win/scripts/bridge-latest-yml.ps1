# Writes the electron-updater latest.yml that moves installed Electron copies onto the Tauri NSIS setup.
# Usage: bridge-latest-yml.ps1 -Setup <draggy_setup.exe> -Version <x.y.z> -Out <latest.yml>
param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
$name = Split-Path -Leaf $Setup
$sha = [System.Security.Cryptography.SHA512]::Create()
$stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Setup).ProviderPath)
try { $digest = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
$size = (Get-Item -LiteralPath $Setup).Length
$date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$yaml = @"
version: $Version
files:
  - url: $name
    sha512: $digest
    size: $size
path: $name
sha512: $digest
releaseDate: '$date'
"@
$outPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
[System.IO.File]::WriteAllText($outPath, $yaml + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Output "wrote $Out for $name ($size bytes)"
