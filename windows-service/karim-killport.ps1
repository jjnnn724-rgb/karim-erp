# karim-killport.ps1 — free a TCP port by killing the owning process tree.
# Walks up from the port owner through node.exe/cmd.exe ancestors and kills
# the whole tree, then re-checks for supervisor respawns for up to 6 rounds.
# Usage: powershell -File karim-killport.ps1 -Port 5000
param([int]$Port = 5000)

function Kill-Tree([int]$procId) {
    $chain = @()
    $cur = $procId
    for ($i = 0; $i -lt 12; $i++) {
        if ($chain -contains $cur) { break }
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $p) { break }
        $chain += $cur
        $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $par -or ($par.Name -notin @('node.exe', 'cmd.exe'))) { break }
        $cur = $par.ProcessId
    }
    if ($chain.Count -gt 0) {
        $root = $chain[$chain.Count - 1]
        Write-Host ("      killing tree root " + $root + "  (chain: " + ($chain -join ' <- ') + ")")
        Start-Process -FilePath taskkill.exe -ArgumentList "/PID $root /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
    }
}

for ($round = 1; $round -le 6; $round++) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host ("      port " + $Port + " is FREE (round " + $round + ")")
        exit 0
    }
    if ($round -gt 1) { Write-Host ("      respawn detected - round " + $round) }
    foreach ($c in $conns) { Kill-Tree ([int]$c.OwningProcess) }
    Start-Sleep -Seconds 5
}

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    Write-Host ("      [FAILED] port " + $Port + " still busy after 6 rounds")
    exit 1
}
Write-Host ("      port " + $Port + " is FREE")
exit 0
