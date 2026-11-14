<#
.SYNOPSIS
  install-watchdog.ps1 — تسجيل watchdog-health كجدولة Windows (SCHTASKS /schtasks create)

.DESCRIPTION
  تُنفّذ على أجهزتك الإنتاجية. يحتاج PowerShell admin.
  يسجل watchdog ليتحقق كل 60 ثانية من /api/health. إذا فشل WATCHDOG_HEALTH_URL
  أكثر من مرة متتالية، يُكتب إلى logs/watchdog-YYYY-MM-DD.log، وإذا 3 متتالية → POST إلى WATCHDOG_WEBHOOK.
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Watch = Join-Path $Root 'scripts' 'watchdog-health.mjs'
$TaskName = 'KarimERP-Health-Watchdog'
$RunAs = $env:USERNAME
$Cmd = "node `"$Watch`""

# التسجيل الأول يقبل التنفيذ كل دقيقة مرة واحدة على الأقل
schtasks /create /tn $TaskName /tr "cmd /c $Cmd" /sc minute /mo 1 /ru $RunAs /rl LIMITED /f 2>&1 | Out-String | Write-Host

Write-Host "✓ Watchdog مسجلة تحت الاسم: $TaskName"
Write-Host "   مكان الفحص: $Watch"
Write-Host "   النتائج:      logs/watchdog-<YYYY-MM-DD>.log"
Write-Host "   إلغاء التسجيل:  schtasks /delete /tn $TaskName /f"
