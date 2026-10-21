function Resolve-BackupGpg {
    [CmdletBinding()]
    param(
        [string]$Recipient = $env:KARIM_BACKUP_GPG_RECIPIENT,
        [string]$GpgPath = $env:KARIM_GPG_PATH
    )

    if ([string]::IsNullOrWhiteSpace($Recipient)) {
        throw 'KARIM_BACKUP_GPG_RECIPIENT must contain the organization public-key fingerprint; plaintext archive creation is disabled.'
    }
    $Recipient = $Recipient.Trim()
    if ($Recipient -notmatch '^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$') {
        throw 'KARIM_BACKUP_GPG_RECIPIENT must be a 40- or 64-character OpenPGP public-key fingerprint.'
    }
    if ([string]::IsNullOrWhiteSpace($GpgPath)) {
        $gpg = Get-Command gpg -ErrorAction SilentlyContinue
        if (-not $gpg) {
            throw 'GPG is required for encrypted backup archives; configure KARIM_GPG_PATH.'
        }
        $GpgPath = $gpg.Source
    }
    if (-not (Test-Path -LiteralPath $GpgPath -PathType Leaf)) {
        throw "Configured GPG executable does not exist: $GpgPath"
    }

    return @{
        Recipient = $Recipient.ToUpperInvariant()
        GpgPath = [IO.Path]::GetFullPath($GpgPath)
    }
}

function Protect-BackupArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][string]$Recipient,
        [Parameter(Mandatory = $true)][string]$GpgPath
    )

    if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf) -or
        (Get-Item -LiteralPath $InputPath).Length -eq 0) {
        throw 'Backup archive is missing or empty; encryption was not attempted.'
    }
    if (Test-Path -LiteralPath $OutputPath) {
        throw "Encrypted backup already exists; refusing to overwrite it: $OutputPath"
    }

    try {
        & $GpgPath --batch --yes --trust-model always --recipient $Recipient `
            --output $OutputPath --encrypt $InputPath
        if ($LASTEXITCODE -ne 0 -or
            -not (Test-Path -LiteralPath $OutputPath -PathType Leaf) -or
            (Get-Item -LiteralPath $OutputPath).Length -eq 0) {
            throw "GPG encryption failed (exit code $LASTEXITCODE)."
        }
    } catch {
        if (Test-Path -LiteralPath $OutputPath) {
            Remove-Item -LiteralPath $OutputPath -Force
        }
        throw
    }
}

function Set-PrivateBackupAcl {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Private backup ACL enforcement is supported only on Windows.'
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path '/inheritance:r' '/grant:r' `
        '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' "$($identity):(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict backup directory permissions: $Path"
    }
}
