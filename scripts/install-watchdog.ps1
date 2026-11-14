<#
.SYNOPSIS
  install-watchdog.ps1 — تسجيل حارس الصحة كجدولة Windows (يعمل كل دقيقة)

.DESCRIPTION
  ينشئ wrapper watchdog-run.cmd حول scripts/watchdog-health.mjs ثم يسجله
  عبر schtasks بصلاحية محدودة (LIMITED — بلا admin). لا يعدّل أي بيانات؛
  كل ما يفعله هو طلب /api/health مرة كل 60 ثانية وتسجيل النتيجة في
  logs/watchdog-YYYY-MM-DD.log.

  ملاحظة: يفضّل تشغيله من PowerShell معضوب اليد:
  PowerShell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1

  إلغاء:  schtasks /delete /tn "KarimERP-Health-Watchdog" /f
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wrapper = Join-Path $Root 'scripts' 'watchdog-run.cmd'
$ScriptPath = Join-Path $Root 'scripts' 'watchdog-health.mjs'
$TaskName = 'KarimERP-Health-Watchdog'

# (1) wrapper — schtasks /tr لا يحب الأقواس والاقتباسات المتداخلة في cmd /c node "..."
Set-Content -Path $Wrapper -Value "@echo off`r`nnode `"$ScriptPath`"" -NoNewline -Encoding ascii
Write-Host "✓ wrapper جاهز: $Wrapper"

# (2) التسجيل — صلاحية محدودة (بلا admin)
& schtasks /create /tn $TaskName /tr $Wrapper /sc minute /mo 1 /rl LIMITED /f | Out-String | Write-Host

# (3) تحقق فوري
& schtasks /query /tn $TaskName /v /fo LIST | Select-String 'TaskName|Next Run|Last Result|Status' | ForEach-Object { Write-Host $_.Line }

Write-Host "✓ الحارس يعمل كل دقيقة — السجل: $Root\logs\watchdog-<YYYY-MM-DD>.log"
Write-Host "  الإلغاء: schtasks /delete /tn $TaskName /f"
