# keep-awake.ps1 — يمنع نوم الويندوز أثناء عمل سيرفر karim ERP
# يعمل بدون صلاحيات مدير (طلب تنفيذ مستمر يمنع النوم التلقائي للخمول)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StayAwake {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
$ES_CONTINUOUS = 0x80000000
$ES_SYSTEM_REQUIRED = 0x00000001
while ($true) {
    [StayAwake]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
    Start-Sleep -Seconds 50
}
