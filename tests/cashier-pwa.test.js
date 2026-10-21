const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const PWA = path.join(APP, 'cashier');
const read = (file) => fs.readFileSync(file, 'utf8');

describe('Cashier V2 standalone PWA', () => {
    test('has an installable manifest scoped only to the cashier app', () => {
        const manifest = JSON.parse(read(path.join(PWA, 'manifest.json')));
        expect(manifest.start_url).toBe('/app/cashier/');
        expect(manifest.scope).toBe('/app/cashier/');
        expect(manifest.display).toBe('standalone');
        expect(manifest.icons).toEqual(expect.arrayContaining([
            expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
            expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
        ]));
        expect(read(path.join(PWA, 'index.html'))).toContain('href="/app/cashier/manifest.json"');
        expect(read(path.join(PWA, 'main.js'))).toContain("navigator.serviceWorker.register('/app/cashier/sw.js'");
    });

    test('loads only the shared login and cashier screens, never the ERP shell', () => {
        const entry = read(path.join(PWA, 'main.js'));
        const html = read(path.join(PWA, 'index.html'));
        expect(entry).toContain("mountLoginScreen");
        expect(entry).toContain("mountPosEntryScreen");
        expect(entry).toContain("salesEnabled: true");
        expect(entry).toContain("ALLOWED_ROLES = ['admin', 'manager', 'accountant', 'cashier']");
        expect(entry).not.toContain("preview.js");
        expect(html).not.toContain('erp-v2-root');
        expect(html).toContain('data-cashier-main');
    });

    test('uses an adaptive, denser product grid only in the standalone cashier', () => {
        const css = read(path.join(PWA, 'cashier.css'));
        const html = read(path.join(PWA, 'index.html'));
        expect(css).toContain('.cashier-app-main .erp-pos-v2-products');
        expect(css).toContain('minmax(clamp(6.25rem, 7vw, 7.75rem), 1fr)');
        expect(css).toContain('aspect-ratio: 1.6 / 1');
        expect(css).toContain('font-size: clamp(0.75rem, 0.85vw, 0.875rem)');
        expect(css).toContain('@media (max-width: 900px)');
        expect(css).toContain('@media (max-width: 520px)');
        expect(css).toContain('.cashier-app-main .erp-pos-v2-order');
        expect(html).toContain('cashier.css?v=1.2.0');
        expect(read(path.join(PWA, 'sw.js'))).toContain("karim-cashier-shell-v2");
    });

    test('service worker never caches API, realtime, upload or mutation requests', () => {
        const worker = read(path.join(PWA, 'sw.js'));
        expect(worker).toContain("request.method !== 'GET'");
        expect(worker).toContain("url.pathname.startsWith('/api/')");
        expect(worker).toContain("url.pathname.startsWith('/socket.io/')");
        expect(worker).toContain("url.pathname.startsWith('/uploads/')");
        expect(worker).toContain("key.startsWith('karim-cashier-shell-')");
        expect(worker).not.toContain("keys.filter((key) => ![");
    });

    test('PWA shortcuts use the standalone cashier while ERP retains its production POS', () => {
        const baseManifest = JSON.parse(read(path.join(APP, 'manifest.json')));
        const shortcut = baseManifest.shortcuts.find((item) => item.short_name === 'الكاشير');
        expect(shortcut.url).toBe('/app/cashier/');
        expect(read(path.join(APP, 'js', 'v2', 'screens', 'pos-entry.js')))
            .toContain('href="/app/cashier/"');

        const legacyShell = read(path.join(APP, 'index.html'));
        const cashierEntry = legacyShell.match(/<a\b(?=[^>]*\bhref="\/app\/pos\.html")[^>]*>/);
        expect(cashierEntry).not.toBeNull();
        expect(cashierEntry[0]).toContain('href="/app/pos.html"');
    });
});
