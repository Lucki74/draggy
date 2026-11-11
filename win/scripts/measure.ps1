# Measures one Draggy build: installer size, unpacked size, time to first window and memory at idle.
# Run it on the Electron build and on the Tauri build with the same machine and data folder.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Installer = "",
  [int]$IdleSeconds = 60,
  [int]$Runs = 3
)

$ErrorActionPreference = "Stop"

function Get-Tree([int]$RootId) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $ids = [System.Collections.Generic.List[int]]::new()
  $ids.Add($RootId)
  for ($i = 0; $i -lt $ids.Count; $i++) {
    foreach ($p in $all) {
      if ($p.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) }
    }
  }
  return $ids
}

function Measure-Tree([int]$RootId) {
  $private = 0L; $working = 0L; $count = 0
  foreach ($id in (Get-Tree $RootId)) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($null -eq $p) { continue }
    $private += $p.PrivateMemorySize64; $working += $p.WorkingSet64; $count++
  }
  return [pscustomobject]@{ Processes = $count; PrivateMB = [math]::Round($private / 1MB); WorkingSetMB = [math]::Round($working / 1MB) }
}

function Stop-Tree([int]$RootId) {
  $ids = Get-Tree $RootId
  [array]::Reverse($ids)
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

$dir = Split-Path -Parent (Resolve-Path $Exe)
$unpacked = (Get-ChildItem $dir -Recurse -File | Measure-Object Length -Sum).Sum
$setup = if ($Installer -and (Test-Path $Installer)) { (Get-Item $Installer).Length } else { 0 }

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath $Exe -PassThru
  while ($proc.MainWindowHandle -eq 0 -and $watch.Elapsed.TotalSeconds -lt 60) {
    Start-Sleep -Milliseconds 50
    $proc.Refresh()
  }
  $firstWindow = [math]::Round($watch.Elapsed.TotalMilliseconds)
  Start-Sleep -Seconds $IdleSeconds
  $mem = Measure-Tree $proc.Id
  Stop-Tree $proc.Id
  Start-Sleep -Seconds 3
  $results += [pscustomobject]@{ Run = $run; FirstWindowMs = $firstWindow; Processes = $mem.Processes; PrivateMB = $mem.PrivateMB; WorkingSetMB = $mem.WorkingSetMB }
}

$results | Format-Table -AutoSize
[pscustomobject]@{
  InstallerMB = [math]::Round($setup / 1MB, 1)
  UnpackedMB = [math]::Round($unpacked / 1MB, 1)
  MedianFirstWindowMs = ($results.FirstWindowMs | Sort-Object)[[int][math]::Floor($Runs / 2)]
  MedianPrivateMB = ($results.PrivateMB | Sort-Object)[[int][math]::Floor($Runs / 2)]
  MedianWorkingSetMB = ($results.WorkingSetMB | Sort-Object)[[int][math]::Floor($Runs / 2)]
} | Format-List
