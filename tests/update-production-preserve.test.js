const { spawnSync } = require('child_process');
const path = require('path');

describe('production update preservation paths', () => {
    test('restores preserved nested paths without moving them to the project root', () => {
        if (process.platform !== 'win32') {
            return;
        }

        const helperPath = path.resolve(__dirname, '..', 'scripts', 'deployment-preserve.ps1');
        const escapedHelperPath = helperPath.replace(/'/g, "''");
        const script = `
$ErrorActionPreference = 'Stop'
. '${escapedHelperPath}'
$root = Join-Path $env:TEMP ('karim-preserve-test-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $root 'install'
$stash = Join-Path $root 'stash'
$paths = @('.env', 'node_modules', 'database\\backups', 'database\\data', 'logs', '.git')
try {
    foreach ($relativePath in $paths) {
        $source = Join-Path $install $relativePath
        if ($relativePath -eq '.env') {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $source) | Out-Null
            Set-Content -LiteralPath $source -Value "original:$relativePath"
        } else {
            New-Item -ItemType Directory -Force -Path $source | Out-Null
            Set-Content -LiteralPath (Join-Path $source 'sentinel.txt') -Value "original:$relativePath"
        }
    }
    Save-PreservedPaths -InstallDirectory $install -StashDirectory $stash -RelativePaths $paths
    foreach ($relativePath in $paths) {
        $destination = Join-Path $install $relativePath
        if ($relativePath -eq '.env') {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Set-Content -LiteralPath $destination -Value "release:$relativePath"
        } else {
            New-Item -ItemType Directory -Force -Path $destination | Out-Null
            Set-Content -LiteralPath (Join-Path $destination 'sentinel.txt') -Value "release:$relativePath"
        }
    }
    Restore-PreservedPaths -InstallDirectory $install -StashDirectory $stash -RelativePaths $paths
    foreach ($relativePath in $paths) {
        $destination = Join-Path $install $relativePath
        $contentPath = if ($relativePath -eq '.env') { $destination } else { Join-Path $destination 'sentinel.txt' }
        if ((Get-Content -LiteralPath $contentPath -Raw).Trim() -ne "original:$relativePath") {
            throw "Preserved content mismatch: $relativePath"
        }
    }
    if (Test-Path -LiteralPath (Join-Path $install 'backups')) {
        throw 'Nested backup directory was incorrectly restored at project root.'
    }
} finally {
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
`;
        const result = spawnSync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script,
        ], { encoding: 'utf8', timeout: 30000 });

        expect(result.error).toBeUndefined();
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || `PowerShell exited with status ${result.status}`);
        }
        expect(result.status).toBe(0);
    });

    test('switches deployments and restores the previous tree without losing preserved data', () => {
        if (process.platform !== 'win32') {
            return;
        }

        const helperPath = path.resolve(__dirname, '..', 'scripts', 'deployment-preserve.ps1');
        const escapedHelperPath = helperPath.replace(/'/g, "''");
        const script = `
$ErrorActionPreference = 'Stop'
. '${escapedHelperPath}'
$root = Join-Path $env:TEMP ('karim-switch-test-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $root 'install'
$staging = Join-Path $root 'staging'
$previous = Join-Path $root 'previous'
$retained = Join-Path $root 'releases\\previous-release'
$failed = Join-Path $root 'failed'
$preserve = @('.env', 'node_modules', 'database\\backups', 'database\\data', 'logs', '.git')
try {
    foreach ($directory in @('backend', 'database\\scripts', 'scripts')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $staging $directory) | Out-Null
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $install 'backend') | Out-Null
    Set-Content -LiteralPath (Join-Path $install 'backend\\server.js') -Value 'old-release'
    Set-Content -LiteralPath (Join-Path $staging 'backend\\server.js') -Value 'new-release'
    Set-Content -LiteralPath (Join-Path $staging 'package.json') -Value '{}'
    Set-Content -LiteralPath (Join-Path $staging 'database\\scripts\\run-migration.js') -Value ''
    Set-Content -LiteralPath (Join-Path $staging 'scripts\\serve.js') -Value ''
    Assert-DeploymentPackage -ReleaseDirectory $staging
    Set-Content -LiteralPath (Join-Path $staging '.env') -Value 'release-secret=must-not-be-packaged'
    try {
        Assert-DeploymentPackage -ReleaseDirectory $staging
        throw 'Release package containing .env was unexpectedly accepted.'
    } catch {
        if ($_.Exception.Message -eq 'Release package containing .env was unexpectedly accepted.') { throw }
    }
    Remove-Item -LiteralPath (Join-Path $staging '.env') -Force
    foreach ($relativePath in $preserve) {
        $oldPath = Join-Path $install $relativePath
        $newPath = Join-Path $staging $relativePath
        if ($relativePath -eq '.env') {
            Set-Content -LiteralPath $oldPath -Value "original:$relativePath"
            Set-Content -LiteralPath $newPath -Value "release:$relativePath"
        } else {
            New-Item -ItemType Directory -Force -Path $oldPath, $newPath | Out-Null
            Set-Content -LiteralPath (Join-Path $oldPath 'sentinel.txt') -Value "original:$relativePath"
            Set-Content -LiteralPath (Join-Path $newPath 'sentinel.txt') -Value "release:$relativePath"
        }
    }

    Switch-DeploymentDirectory -InstallDirectory $install -StagingDirectory $staging -PreviousDirectory $previous -PreservedPaths $preserve
    if ((Get-Content -LiteralPath (Join-Path $install 'backend\\server.js') -Raw).Trim() -ne 'new-release') {
        throw 'New release was not switched into place.'
    }
    foreach ($relativePath in $preserve) {
        $contentPath = Join-Path $install $relativePath
        if ($relativePath -ne '.env') { $contentPath = Join-Path $contentPath 'sentinel.txt' }
        if ((Get-Content -LiteralPath $contentPath -Raw).Trim() -ne "original:$relativePath") {
            throw "Preserved data was not retained: $relativePath"
        }
    }

    $liveDependencies = Join-Path $install 'node_modules\\sentinel.txt'
    $retainedDependencies = Join-Path $previous 'node_modules\\sentinel.txt'
    if ((Get-Content -LiteralPath $liveDependencies -Raw).Trim() -ne 'original:node_modules' -or
        (Get-Content -LiteralPath $retainedDependencies -Raw).Trim() -ne 'original:node_modules') {
        throw 'Dependencies were not copied to the new release while retained in the previous release.'
    }

    Retain-PreviousDeployment -PreviousDirectory $previous -RetainedDirectory $retained
    if (Test-Path -LiteralPath $previous) {
        throw 'Previous release was not moved out of the temporary work directory.'
    }
    if ((Get-Content -LiteralPath (Join-Path $retained 'backend\\server.js') -Raw).Trim() -ne 'old-release') {
        throw 'Persistent previous release contents were not retained.'
    }
    try {
        Retain-PreviousDeployment -PreviousDirectory $install -RetainedDirectory $retained
        throw 'Existing retained release path was unexpectedly overwritten.'
    } catch {
        if ($_.Exception.Message -eq 'Existing retained release path was unexpectedly overwritten.') { throw }
    }

    Restore-PreviousDeployment -InstallDirectory $install -StagingDirectory $staging -PreviousDirectory $retained -FailedDirectory $failed -PreservedPaths $preserve
    if ((Get-Content -LiteralPath (Join-Path $install 'backend\\server.js') -Raw).Trim() -ne 'old-release') {
        throw 'Previous release was not restored.'
    }
    if ((Get-Content -LiteralPath (Join-Path $install '.env') -Raw).Trim() -ne 'original:.env') {
        throw 'Preserved configuration was not restored with the previous release.'
    }
    if ((Get-Content -LiteralPath (Join-Path $failed 'backend\\server.js') -Raw).Trim() -ne 'new-release') {
        throw 'Failed release was not retained for diagnosis.'
    }
    if ((Get-Content -LiteralPath (Join-Path $install 'node_modules\\sentinel.txt') -Raw).Trim() -ne 'original:node_modules') {
        throw 'Previous release dependencies were not restored.'
    }

    try {
        Switch-DeploymentDirectory -InstallDirectory $install -StagingDirectory $failed -PreviousDirectory $previous -PreservedPaths @('..\\outside')
        throw 'Path traversal was unexpectedly accepted.'
    } catch {
        if ($_.Exception.Message -eq 'Path traversal was unexpectedly accepted.') { throw }
    }
    if ((Get-Content -LiteralPath (Join-Path $install 'backend\\server.js') -Raw).Trim() -ne 'old-release') {
        throw 'Rejected path traversal changed the installed release.'
    }
} finally {
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
`;
        const result = spawnSync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script,
        ], { encoding: 'utf8', timeout: 30000 });

        expect(result.error).toBeUndefined();
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || `PowerShell exited with status ${result.status}`);
        }
        expect(result.status).toBe(0);
    });
});
