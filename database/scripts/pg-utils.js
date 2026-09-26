const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(DB_DIR, 'data');
const BUNDLED_BIN_DIRS = [
    path.join(DB_DIR, 'bin', 'bin'),
    path.join(DB_DIR, 'bin'),
];

function getPlatformBinaryNames(baseName) {
    return process.platform === 'win32'
        ? [`${baseName}.exe`, baseName]
        : [baseName];
}

function resolveFromDirectories(baseName, directories) {
    for (const dir of directories) {
        for (const candidate of getPlatformBinaryNames(baseName)) {
            const fullPath = path.join(dir, candidate);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }

    return null;
}

function resolveFromPath(baseName) {
    const pathDirs = (process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean);

    return resolveFromDirectories(baseName, pathDirs);
}

function resolveBinary(baseName) {
    if (process.platform === 'win32') {
        return resolveFromDirectories(baseName, BUNDLED_BIN_DIRS) || resolveFromPath(baseName);
    }

    return resolveFromPath(baseName) || resolveFromDirectories(baseName, BUNDLED_BIN_DIRS);
}

function hasBundledWindowsPostgres() {
    return [
        path.join(DB_DIR, 'bin', 'bin', 'pg_ctl.exe'),
        path.join(DB_DIR, 'bin', 'pg_ctl.exe'),
    ].some(filePath => fs.existsSync(filePath));
}

module.exports = {
    DB_DIR,
    DATA_DIR,
    resolveBinary,
    hasBundledWindowsPostgres,
};
