# raw-print.ps1 — إرسال بايتات ESC/POS خام إلى طابور طباعة ويندوز محلي.
# يُستدعى من print-worker.js للنوع windows_local:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File raw-print.ps1 -PrinterName "POS-80" -File "C:\...\job.bin"
# لا تنسيق ولا معالجة سائق: البيانات تُسلَّم كـ RAW كما لو أن برنامج الكاشير كتبها.
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class KarimRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void Send(string printer, byte[] bytes)
    {
        IntPtr handle;
        if (!OpenPrinter(printer, out handle, IntPtr.Zero))
        {
            throw new Exception("OpenPrinter failed (" + Marshal.GetLastWin32Error() + ") for " + printer);
        }
        try
        {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Karim ERP POS";
            di.pDataType = "RAW";
            if (!StartDocPrinter(handle, 1, di))
            {
                throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
            }
            try
            {
                if (!StartPagePrinter(handle))
                {
                    throw new Exception("StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")");
                }
                IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, buffer, bytes.Length);
                    int written;
                    if (!WritePrinter(handle, buffer, bytes.Length, out written))
                    {
                        throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")");
                    }
                    if (written != bytes.Length)
                    {
                        throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes");
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(buffer);
                }
                EndPagePrinter(handle);
            }
            finally
            {
                EndDocPrinter(handle);
            }
        }
        finally
        {
            ClosePrinter(handle);
        }
    }
}
"@

if (-not (Test-Path -LiteralPath $File)) {
    throw "Payload file not found: $File"
}

$bytes = [System.IO.File]::ReadAllBytes($File)
if ($bytes.Length -eq 0) {
    throw "Payload is empty"
}

[KarimRawPrinter]::Send($PrinterName, $bytes)
