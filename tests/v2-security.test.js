const fs = require('fs');
const path = require('path');
const { buildV2Csp } = require('../backend/middleware/security');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const V2_JS = path.join(APP, 'js', 'v2');
const read = (file) => fs.readFileSync(file, 'utf8');

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {return jsFiles(file);}
        return entry.name.endsWith('.js') ? [file] : [];
    });
}

describe('V2 document security boundary', () => {
    test('uses a same-origin script policy with inline event handlers disabled', () => {
        const csp = buildV2Csp();
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("script-src-attr 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
        expect(csp).not.toContain('https:');
    });

    test('the strict policy is applied only to the V2 document before static serving', () => {
        const server = read(path.join(ROOT, 'backend', 'server.js'));
        const policy = server.indexOf("req.path === '/app/v2.html'");
        const staticFiles = server.indexOf("app.use('/app', appBrotli)");
        expect(policy).toBeGreaterThanOrEqual(0);
        expect(server.slice(policy, staticFiles)).toContain('buildV2Csp()');
        expect(staticFiles).toBeGreaterThan(policy);
    });

    test('V2 has no inline event-handler attributes', () => {
        const sources = [read(path.join(APP, 'v2.html')), ...jsFiles(V2_JS).map(read)];
        const inlineHandlers = sources.flatMap((source) =>
            [...source.matchAll(/<[a-z][^>]*\son[a-z]+\s*=/gi)].map((match) => match[0]));
        expect(inlineHandlers).toEqual([]);
    });

    test('the component gallery is opt-in and never appears in live mode', () => {
        const preview = read(path.join(V2_JS, 'preview.js'));
        expect(preview).toMatch(/const SHOWCASE_MODE = !LIVE && .*get\('showcase'\) === '1'/);
        expect(preview).toMatch(/if \(SHOWCASE_MODE\) \{/);
        expect(preview).not.toContain('EnterpriseDataTable — مرحلة ٣');
    });
});
