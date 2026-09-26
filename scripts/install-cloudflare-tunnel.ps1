#requires -RunAsAdministrator
param([string]$Hostname = '')
$ErrorActionPreference = 'Stop'

Write-Host 'مطاعم الشرفه العالمي — تثبيت Cloudflare Tunnel' -ForegroundColor Cyan
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw 'cloudflared غير مثبت. ثبّته من صفحة Cloudflare الرسمية ثم أعد تشغيل السكربت.'
}

$token = Read-Host 'أدخل رمز Tunnel من Cloudflare (لن يتم حفظه في المشروع)' 
if ([string]::IsNullOrWhiteSpace($token)) { throw 'لم يتم إدخال رمز Tunnel.' }

add-type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class NoCheckLocal { public static bool Check(object s, X509Certificate c, X509Chain ch, System.Net.Security.SslPolicyErrors e) { return true; } }
"@ | Out-Null
[Net.ServicePointManager]::ServerCertificateValidationCallback = [NoCheckLocal]::Check
$ok = $false
foreach ($scheme in @('https', 'http')) {
    try {
        $r = Invoke-WebRequest -Uri "${scheme}://127.0.0.1:5000/api/health" -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
}
if (-not $ok) { throw 'خادم ERP لا يستجيب على 127.0.0.1:5000. شغّل النظام أولًا.' }

& cloudflared service uninstall 2>$null
& cloudflared service install $token
Set-Service -Name 'Cloudflared' -StartupType Automatic
Start-Service -Name 'Cloudflared'

Start-Sleep -Seconds 3
$service = Get-Service -Name 'Cloudflared'
if ($service.Status -ne 'Running') { throw "فشل تشغيل خدمة Cloudflared. الحالة: $($service.Status)" }
Write-Host 'تم تثبيت وتشغيل Cloudflare Tunnel بنجاح.' -ForegroundColor Green
if ($Hostname) { Write-Host "اختبر الآن: https://$Hostname" -ForegroundColor Yellow }
else { Write-Host 'اختبر الآن عبر اسم النطاق المربوط بالـ Tunnel في Cloudflare.' -ForegroundColor Yellow }
