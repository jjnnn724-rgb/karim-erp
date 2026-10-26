const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHIELDS = fs.readFileSync(path.join(ROOT, 'backend', 'errors', 'error-handler.js'), 'utf8');
const SHUTDOWN = fs.readFileSync(path.join(ROOT, 'backend', 'graceful-shutdown.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
const SERVICE = fs.readFileSync(path.join(ROOT, 'windows-service', 'KarimERP-Service.xml'), 'utf8');

describe('server crash recovery policy', () => {
    test('fatal process errors default to a controlled exit and service restart', () => {
        expect(SHIELDS).toContain("exitOnFatal = String(process.env.SHIELD_EXIT_ON_FATAL || 'true').toLowerCase() !== 'false'");
        expect(SHIELDS).toMatch(/if \(exitOnFatal\) \{triggerFatalShutdown\(1, (?:err|appErr), onFatal, shutdownTimeoutMs\);\}/);
        expect(SERVER).toMatch(/installProcessShields\(\{\s*exitOnFatal: true,/);
    });

    test('graceful signal handling does not suppress uncaught process failures', () => {
        expect(SHUTDOWN).not.toMatch(/process\.on\(['"](?:uncaughtException|unhandledRejection)['"]/);
        expect(SHUTDOWN).toMatch(/process\.on\(signal/);
    });

    test('Windows service continues restarting after repeated failures with backoff', () => {
        const actions = [...SERVICE.matchAll(/<onfailure action="([^"]+)" delay="([^"]+)"\s*\/>/g)]
            .map((match) => ({ action: match[1], delay: match[2] }));
        expect(actions).toEqual([
            { action: 'restart', delay: '10 sec' },
            { action: 'restart', delay: '30 sec' },
            { action: 'restart', delay: '60 sec' },
        ]);
        expect(SERVICE).not.toContain('<onfailure action="none"');
    });

    test('periodic GL and Oracle jobs cannot pile up overlapping work', () => {
        expect(SERVER).toMatch(/let yaraGlSweepRunning = false;[\s\S]*?if \(yaraGlSweepRunning\) \{return;\}[\s\S]*?finally \{\s*yaraGlSweepRunning = false;/);
        expect(SERVER).toMatch(/let activeOracleWorker = null;[\s\S]*?if \(activeOracleWorker\) \{[\s\S]*?worker\.once\('exit'/);
        expect(SERVER).toMatch(/worker\.once\('error'/);
    });
});
