# Karim ERP - Guardian v2 (STEEL layer: permanent smart supervision)
# Monitors EVERY layer every 5 minutes and heals safe issues automatically:
#   1. KarimERP-Server service must be RUNNING (else: start it)
#   2. https://127.0.0.1:5001/api/health must answer (else: safe service restart)
#   3. Tailscale daemon must be up (else: start Tailscale service)
#   4. Public HTTPS entry https://127.0.0.1:443 must answer (else: re-apply
#      `tailscale serve` mapping; if the CLI is denied, raise a loud alert)
#  - NEVER taskkills. Service restarts only after 3 failed probes.
#  - Every heal writes a restart-flag so the server notifies managers on WhatsApp.
#  - Install once as Admin (SYSTEM, every 5 min):
#    schtasks /create /tn "KarimERP-Guardian" `
#      /tr "powershell -NoProfile -ExecutionPolicy Bypass -File '<repo>\scripts\steel-watchdog.ps1'" `
#      /sc minute /mo 5 /ru SYSTEM /f
$ErrorActionPreference = 'SilentlyContinue'
$HealthUrl = 'https://127.0.0.1:5001/api/health'
$PublicUrl = 'https://127.0.0.1:443/api/health'
$Service = 'KarimERP-Server'
$LogDir = 'C:\KarimData\watchdog'
$Log = Join-Path $LogDir 'watchdog.log'
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function WLog($m) { Add-Content $Log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }
function Write-RecoveryFlag($reason) {
    try {
        $flag = @{ at = (Get-Date -Format 'o'); reason = $reason } | ConvertTo-Json
        $flag | Out-File (Join-Path $LogDir 'restart-flag.json') -Encoding utf8
    } catch { }
}
function Test-Health($url, $tries = 3) {
    for ($i = 1; $i -le $tries; $i++) {
        try {
            $r = Invoke-RestMethod -Uri $url -TimeoutSec 12
            if ($r.status -in @('ok', 'warn')) { return $true }
        } catch { }
        if ($i -lt $tries) { Start-Sleep -Seconds 10 }
    }
    return $false
}

# Self-guard: only ONE guardian instance at a time (mutex)
$mutex = New-Object System.Threading.Mutex($false, 'Global\KarimERP-Watchdog')
if (!$mutex.WaitOne(0)) { exit 0 }
try {
    add-type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class TrustAll { public static void On() {
  ServicePointManager.ServerCertificateValidationCallback =
    delegate { return true; }; } }
"@
    [TrustAll]::On()

    # Maintenance gate: an explicit stop from the control panel must not be
    # undone by this guardian. Mirrors backend/server-control-maintenance.js:
    # 'stopped' is respected forever; transient states only for 10 minutes.
    $MaintSkip = $false
    try {
        $MaintFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\maintenance.json'
        if (Test-Path $MaintFile) {
            $m = Get-Content $MaintFile -Raw | ConvertFrom-Json
            if ($m.state -eq 'stopped') { $MaintSkip = $true }
            elseif ($m.state -in @('stopping', 'starting', 'restarting')) {
                $at = [datetime]::Parse($m.at)
                if (((Get-Date) - $at).TotalMinutes -lt 10) { $MaintSkip = $true }
            }
            if ($MaintSkip) { WLog ("maintenance={0} - ERP healing skipped" -f $m.state) }
        }
    } catch { WLog "maintenance flag unreadable - continuing normal checks" }

    # Layer 1: Windows service must be RUNNING
    try {
        $svc = Get-Service -Name $Service
        if ($svc.Status -ne 'Running' -and !$MaintSkip) {
            WLog ("service {0} is {1} - starting it" -f $Service, $svc.Status)
            Write-RecoveryFlag 'guardian-service-not-running'
            Start-Service -Name $Service
            Start-Sleep -Seconds 40
        }
    } catch { WLog ("service check failed: {0}" -f $_.Exception.Message) }

    # Layer 2: local app health (safe restart only after 3 failed probes)
    if (!$MaintSkip -and !(Test-Health $HealthUrl)) {
        WLog "HEALTH DOWN x3 - safe restart of $Service (never taskkill)"
        Write-RecoveryFlag 'guardian-health-down-x3'
        Restart-Service -Name $Service -Force
        Start-Sleep -Seconds 45
        if (Test-Health $HealthUrl 1) { WLog "service restarted, health back" }
        else { WLog "ALERT: restart did NOT restore health - manual intervention needed" }
    }

    # Layer 3: Tailscale daemon must be up (PrintWorker-style: start service)
    try {
        $ts = Get-Service -Name 'Tailscale' -ErrorAction Stop
        if ($ts.Status -ne 'Running') {
            WLog "Tailscale service is {0} - starting it" -f $ts.Status
            Start-Service -Name 'Tailscale'
            Start-Sleep -Seconds 20
        }
    } catch { WLog "Tailscale service not found or cannot start - check install" }

    # Layer 4: public HTTPS entry (tailscale serve) must answer.
    # Detection is end-to-end (no CLI needed). Repair tries the CLI; if the
    # daemon denies it (other-user install), we alert loudly instead.
    if (!$MaintSkip -and !(Test-Health $PublicUrl 2)) {
        WLog "public HTTPS :443 DOWN - re-applying tailscale serve mapping"
        try {
            $out = & tailscale serve --bg https+insecure://127.0.0.1:5001 2>&1 | Out-String
            Start-Sleep -Seconds 15
            if (Test-Health $PublicUrl 1) { WLog "serve mapping restored"; Write-RecoveryFlag 'guardian-serve-restored' }
            else { WLog ("ALERT: serve still down, tailscale said: {0} - re-run serve command as Admin once" -f $out.Trim()) }
        } catch { WLog "ALERT: cannot run tailscale CLI - re-apply serve mapping manually as Admin" }
    }

    # Layer 5: stable public entry (zrok reserved name). The share runs in the
    # user session (SYSTEM identity cannot hold the reserved name), so this
    # layer only ALERTS loudly on failure - it cannot relaunch another identity.
    $ZrokUrl = 'https://karim-erp.shares.zrok.io'
    if (!$MaintSkip -and $ZrokUrl -and !(Test-Health ($ZrokUrl + '/api/health') 2)) {
        WLog "ALERT: public entry DOWN - open zrok-share-window.bat in the user session (or reboot + log on if Startup shortcut installed)"
        Write-RecoveryFlag 'guardian-zrok-down'
    }
} finally { $mutex.ReleaseMutex() | Out-Null }
