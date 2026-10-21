function Assert-DeploymentRelativePaths {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$RelativePaths)

    foreach ($relativePath in $RelativePaths) {
        if ([string]::IsNullOrWhiteSpace($relativePath) -or
            [IO.Path]::IsPathRooted($relativePath) -or
            $relativePath.Contains(':') -or
            $relativePath -match '(^|[\\/])\.\.([\\/]|$)') {
            throw "Deployment path must stay relative to its deployment directory: $relativePath"
        }
    }
}

function Assert-DeploymentPackage {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)

    foreach ($requiredPath in @('package.json', 'backend\server.js', 'database\scripts\run-migration.js', 'scripts\serve.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ReleaseDirectory $requiredPath) -PathType Leaf)) {
            throw "Release package is incomplete; required file is missing: $requiredPath"
        }
    }

    foreach ($reservedPath in @('.env', 'database\backups', 'database\data', 'logs', '.git')) {
        if (Test-Path -LiteralPath (Join-Path $ReleaseDirectory $reservedPath)) {
            throw "Release package contains deployment data that must be preserved separately: $reservedPath"
        }
    }
}

function Save-PreservedPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallDirectory,
        [Parameter(Mandatory = $true)][string]$StashDirectory,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )

    Assert-DeploymentRelativePaths -RelativePaths $RelativePaths

    foreach ($relativePath in $RelativePaths) {
        $source = Join-Path $InstallDirectory $relativePath
        if (-not (Test-Path -LiteralPath $source)) { continue }

        $savedPath = Join-Path $StashDirectory $relativePath
        $savedParent = Split-Path -Parent $savedPath
        New-Item -ItemType Directory -Force -Path $savedParent | Out-Null
        Move-Item -LiteralPath $source -Destination $savedPath -Force
    }
}

function Restore-PreservedPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallDirectory,
        [Parameter(Mandatory = $true)][string]$StashDirectory,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )

    Assert-DeploymentRelativePaths -RelativePaths $RelativePaths

    foreach ($relativePath in $RelativePaths) {
        $savedPath = Join-Path $StashDirectory $relativePath
        if (-not (Test-Path -LiteralPath $savedPath)) { continue }

        $destination = Join-Path $InstallDirectory $relativePath
        if (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        $destinationParent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        Move-Item -LiteralPath $savedPath -Destination $destination -Force
    }
}

function Move-DeploymentPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$DestinationDirectory,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths,
        [switch]$KeepDestination
    )

    Assert-DeploymentRelativePaths -RelativePaths $RelativePaths

    foreach ($relativePath in $RelativePaths) {
        $source = Join-Path $SourceDirectory $relativePath
        if (-not (Test-Path -LiteralPath $source)) { continue }

        $destination = Join-Path $DestinationDirectory $relativePath
        if (Test-Path -LiteralPath $destination) {
            if ($KeepDestination) { continue }
            Remove-Item -LiteralPath $destination -Recurse -Force
        }

        $destinationParent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        Move-Item -LiteralPath $source -Destination $destination -Force
    }
}

function Copy-DeploymentPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$DestinationDirectory,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )

    Assert-DeploymentRelativePaths -RelativePaths $RelativePaths

    foreach ($relativePath in $RelativePaths) {
        $source = Join-Path $SourceDirectory $relativePath
        if (-not (Test-Path -LiteralPath $source)) { continue }

        $destination = Join-Path $DestinationDirectory $relativePath
        if (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        $destinationParent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }
}

function Switch-DeploymentDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallDirectory,
        [Parameter(Mandatory = $true)][string]$StagingDirectory,
        [Parameter(Mandatory = $true)][string]$PreviousDirectory,
        [Parameter(Mandatory = $true)][string[]]$PreservedPaths,
        [string[]]$CopyPreservedPaths = @('node_modules')
    )

    Assert-DeploymentRelativePaths -RelativePaths $PreservedPaths
    Assert-DeploymentRelativePaths -RelativePaths $CopyPreservedPaths
    if (@($CopyPreservedPaths | Where-Object { $_ -notin $PreservedPaths }).Count -gt 0) {
        throw 'CopyPreservedPaths must be included in PreservedPaths.'
    }

    $install = [IO.Path]::GetFullPath($InstallDirectory)
    $staging = [IO.Path]::GetFullPath($StagingDirectory)
    $previous = [IO.Path]::GetFullPath($PreviousDirectory)
    $installDrive = [IO.Path]::GetPathRoot($install)

    if ([IO.Path]::GetPathRoot($staging) -ne $installDrive -or
        [IO.Path]::GetPathRoot($previous) -ne $installDrive) {
        throw 'Install, staging, and previous deployment directories must be on the same volume.'
    }
    if (-not (Test-Path -LiteralPath $install -PathType Container) -or
        -not (Test-Path -LiteralPath $staging -PathType Container)) {
        throw 'Install and staging directories must both exist before switching deployments.'
    }
    if (Test-Path -LiteralPath $previous) {
        throw "Previous deployment path already exists: $previous"
    }

    Move-Item -LiteralPath $install -Destination $previous
    try {
        Copy-DeploymentPaths -SourceDirectory $previous -DestinationDirectory $staging -RelativePaths $CopyPreservedPaths
        $movePaths = @($PreservedPaths | Where-Object { $_ -notin $CopyPreservedPaths })
        Move-DeploymentPaths -SourceDirectory $previous -DestinationDirectory $staging -RelativePaths $movePaths
        Move-Item -LiteralPath $staging -Destination $install
    } catch {
        if ((Test-Path -LiteralPath $staging -PathType Container) -and
            (Test-Path -LiteralPath $previous -PathType Container)) {
            Move-DeploymentPaths -SourceDirectory $staging -DestinationDirectory $previous `
                -RelativePaths $PreservedPaths -KeepDestination
        }
        if ((Test-Path -LiteralPath $previous -PathType Container) -and
            -not (Test-Path -LiteralPath $install)) {
            Move-Item -LiteralPath $previous -Destination $install
        }
        throw
    }
}

function Retain-PreviousDeployment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$PreviousDirectory,
        [Parameter(Mandatory = $true)][string]$RetainedDirectory
    )

    $previous = [IO.Path]::GetFullPath($PreviousDirectory)
    $retained = [IO.Path]::GetFullPath($RetainedDirectory)
    if ([IO.Path]::GetPathRoot($previous) -ne [IO.Path]::GetPathRoot($retained)) {
        throw 'Previous and retained deployment directories must be on the same volume.'
    }
    if (-not (Test-Path -LiteralPath $previous -PathType Container)) {
        throw "Previous deployment directory is missing: $previous"
    }
    if (Test-Path -LiteralPath $retained) {
        throw "Retained deployment path already exists: $retained"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $retained) | Out-Null
    [IO.Directory]::Move($previous, $retained)
}

function Restore-PreviousDeployment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallDirectory,
        [Parameter(Mandatory = $true)][string]$StagingDirectory,
        [Parameter(Mandatory = $true)][string]$PreviousDirectory,
        [Parameter(Mandatory = $true)][string]$FailedDirectory,
        [Parameter(Mandatory = $true)][string[]]$PreservedPaths
    )

    Assert-DeploymentRelativePaths -RelativePaths $PreservedPaths

    $install = [IO.Path]::GetFullPath($InstallDirectory)
    $staging = [IO.Path]::GetFullPath($StagingDirectory)
    $previous = [IO.Path]::GetFullPath($PreviousDirectory)
    $failed = [IO.Path]::GetFullPath($FailedDirectory)
    if (-not (Test-Path -LiteralPath $previous -PathType Container)) {
        throw "Previous deployment directory is missing: $previous"
    }
    if (Test-Path -LiteralPath $failed) {
        throw "Failed deployment directory already exists: $failed"
    }

    if (Test-Path -LiteralPath $staging -PathType Container) {
        Move-DeploymentPaths -SourceDirectory $staging -DestinationDirectory $previous `
            -RelativePaths $PreservedPaths -KeepDestination
    }

    if (Test-Path -LiteralPath $install) {
        Move-Item -LiteralPath $install -Destination $failed
        Move-DeploymentPaths -SourceDirectory $failed -DestinationDirectory $previous `
            -RelativePaths $PreservedPaths -KeepDestination
    }

    Move-Item -LiteralPath $previous -Destination $install
}
