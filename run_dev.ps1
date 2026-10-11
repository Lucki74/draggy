# Free port 5173 if a stale Vite from a previous run is holding it.
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $connections = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $connections) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and ($proc.ProcessName -match 'node|electron')) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

if ($PSScriptRoot) {
  Set-Location -LiteralPath $PSScriptRoot
}

npm run electron:dev
