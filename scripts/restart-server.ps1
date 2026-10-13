# scripts/restart-server.ps1 — محرك إعادة تشغيل Karim ERP (مخفي بالكامل)
# ────────────────────────────────────────────────────────────────────────────
# يُستدعى من RESTART-KARIM.vbs (نافذة صفر) — لا يُشغَّل يدويًا من كونسول.
# المراحل: قتل مستهدف (server.js + serve.js supervisor) → التأكد من تحرير
# المنفذ → تشغيل serve.js مخفي بلا متصفح → فحص صحة فعلي حتى 90 ثانية →
# محاولة ثانية تلقائية عند الفشل → ملف حالة + رسالة منبثقة قصيرة.
#
# ملاحظات تشغيلية:
#   • PostgreSQL لا تُلمس إطلاقًا — إعادة تشغيلها تضيف ثوانٍ ومخاطرة بلا داعٍ.
#   • القتل مستهدف بـ CommandLine (عمليات karim-erp فقط) — لا taskkill عام.
#   • عمال الخلفية (print/zatca/attendance-push) لا يُقاطعون — مستقلون عمدًا.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $root 'logs'
$statusFile = Join-Path $logsDir 'restart-status.txt'
$runLog = Join-Path $logsDir 'restart-run.log'
$sw = [Diagnostics.Stopwatch]::StartNew()

function Log($msg) {
    try { Add-Content -Path $runLog -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" -Encoding UTF8 } catch {}
}

function Popup($text, $secs, $type) {
    try { (New-Object -ComObject WScript.Shell).Popup($text, $secs, 'Karim ERP', $type) | Out-Null } catch {}
}

Log '========== بدء إعادة التشغيل =========='

# ─── 0) تجهيز ────────────────────────────────────────────────────────────────
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
$nodeExe = $null
try { $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source } catch {}
if (-not $nodeExe -or -not (Test-Path $nodeExe)) { if (Test-Path "C:\nodejs\node.exe") { $nodeExe = "C:\nodejs\node.exe" } else { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" } }
if (-not (Test-Path $nodeExe)) {
    Log 'FATAL: node.exe غير موجود'
    Popup "فشلت إعادة التشغيل: Node.js غير مثبت أو غير موجود في PATH`nراجع السجل: $runLog" 0 48
    exit 1
}

function Get-ListeningPid {
    try {
        $c = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { return [int]$c.OwningProcess }
    } catch {
        # احتياط لأنظمة بلا Get-NetTCPConnection
        $line = (netstat -ano | Select-String ':5000\s.*LISTENING' | Select-Object -First 1)
        if ($line) { return [int]($line.ToString().Trim().Split(' ')[-1]) }
    }
    return 0
}

function Stop-KarimProcesses {
    # قتل مستهدف: عمليات node.exe الخاصة بهذا المشروع فقط (server + supervisor)
    $killed = 0
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { ($_.CommandLine -like '*backend*server.js*') -or ($_.CommandLine -like '*scripts*serve.js*') }
        foreach ($p in $procs) {
            Log "قتل مستهدف PID=$($p.ProcessId) ($($p.CommandLine.Trim().Substring(0, [Math]::Min(90, $p.CommandLine.Trim().Length))))"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        }
    } catch { Log "تحذير أثناء القتل المستهدف: $($_.Exception.Message)" }
    return $killed
}

$oldPid = Get-ListeningPid
Log "PID الحالي للمستمع على 5000: $oldPid"

# ─── 1) الإيقاف ──────────────────────────────────────────────────────────────
$n = Stop-KarimProcesses
Log "أُوقفت $n عملية"

# ─── 2) التأكد من تحرير المنفذ ───────────────────────────────────────────────
# موجة قتل ثانية دائمًا: المشرف قد يعيد توليد طفل بين الموجتين — المنافسة على
# المنفذ بين طفل بكود قديم وجديد كانت سبب «إعادة التشغيل لا تفعّل التعديلات».
Start-Sleep -Milliseconds 1500
Stop-KarimProcesses | Out-Null
$portFree = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 700
    if ((Get-ListeningPid) -eq 0) { $portFree = $true; break }
}
if (-not $portFree) {
    Log 'المنفذ لم يتحرر — موجة قتل ثانية'
    Stop-KarimProcesses | Out-Null
    Start-Sleep -Seconds 2
    $portFree = ((Get-ListeningPid) -eq 0)
}
Log "المنفذ متحرر: $portFree"

# ─── 3) التشغيل المخفي ───────────────────────────────────────────────────────
function Start-Supervisor {
    $env:KARIM_NO_BROWSER = '1'   # التشغيل الخلفي: لا فتح متصفح
    $p = Start-Process -FilePath $nodeExe -ArgumentList 'scripts/serve.js' `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Log "مشرف جديد PID=$($p.Id)"
    return $p
}

function Test-Health {
    # فحص صحة فعلي عبر HTTPS (تجاوز شهادة الجهاز المحلية) — لا نكتفي بفتح المنفذ
    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = [System.Text.Encoding]::UTF8
        $json = $wc.DownloadString('https://127.0.0.1:5000/api/health')
        $h = $json | ConvertFrom-Json
        if ($h.status -eq 'ok' -or $h.status -eq 'warn') {
            return @{ ok = $true; detail = "pid=$($h.app.pid) boot=$($h.boot.startedAt)" }
        }
        return @{ ok = $false; detail = "status=$($h.status)" }
    } catch { return @{ ok = $false; detail = $_.Exception.Message } }
}

function Wait-Healthy([int]$seconds) {
    $polls = [int]($seconds / 2)
    for ($i = 0; $i -lt $polls; $i++) {
        Start-Sleep -Seconds 2
        $r = Test-Health
        if ($r.ok) { return $r }
    }
    return $r
}

function Restart-Once {
    Start-Supervisor | Out-Null
    return Wait-Healthy 90
}

# ─── 4) التنفيذ + محاولة ثانية عند الفشل ────────────────────────────────────
$result = Restart-Once
if (-not $result.ok) {
    Log "المحاولة الأولى فشلت ($($result.detail)) — إعادة المحاولة تلقائيًا"
    Stop-KarimProcesses | Out-Null
    Start-Sleep -Seconds 3
    $result = Restart-Once
}

$sw.Stop()
$elapsed = [int]$sw.Elapsed.TotalSeconds
$verdict = 'FAILED'

if ($result.ok) {
    $verdict = 'SUCCESS'
    Log "نجاح في $elapsed ثانية — $($result.detail)"
    Popup "تمت إعادة تشغيل السيرفر بنجاح ✓`nالوقت: $elapsed ثانية`n$($result.detail)" 3 64
} else {
    Log "فشل نهائي — $($result.detail)"
    Popup "فشلت إعادة تشغيل السيرفر!`nالتفاصيل في: logs\restart-status.txt`nو logs\restart-run.log" 0 48
}

@"
$verdict
time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
elapsed_s: $elapsed
old_pid: $oldPid
detail: $($result.detail)
"@ | Set-Content -Path $statusFile -Encoding UTF8

exit $(if ($verdict -eq 'SUCCESS') { 0 } else { 1 })
