const { spawnSync } = require('child_process');
const { log } = require('./shared');

// Kill any node process running backend/server.js
if (process.platform === 'win32') {
    // Method 1: taskkill by window title
    spawnSync('taskkill', ['/F', '/FI', 'WINDOWTITLE eq *backend*'], { stdio: 'ignore' });
    // Method 2: PowerShell CIM
    const result = spawnSync('powershell', ['-NoProfile', '-Command', 
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'backend[\\\\/]server\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
    ], { encoding: 'utf-8', timeout: 10000 });
    if (result.status === 0) {
        log.ok('Old server stopped');
    } else {
        log.error(`PowerShell failed: ${result.stderr}`);
    }
} else {
    spawnSync('pkill', ['-f', 'backend/server.js'], { stdio: 'ignore' });
    log.ok('Old server stopped');
}