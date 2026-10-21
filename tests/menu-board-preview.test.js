const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (relativePath) => fs.readFileSync(path.join(APP, relativePath), 'utf8');

describe('Samsung portrait menu preview', () => {
    test('preview uses a scalable 9:16 portrait display and offers fullscreen', () => {
        const html = read('menu-admin.html');
        const css = read('css/menu-admin.css');
        expect(html).toContain('SAMSUNG PORTRAIT · 9:16 · 1080 × 1920');
        expect(html).toContain('onclick="togglePreviewFullscreen()"');
        // المراجع المُصدَّرة تأخذ مراجعة الصفحة — الحراسة تثبّت صيغة `?v=` لا الرقم
        expect(html).toMatch(/menu-admin\.css\?v=\d+\.\d+\.\d+/);
        expect(html).toMatch(/menu-admin\.js\?v=\d+\.\d+\.\d+/);
        expect(css).toMatch(/\.preview-stage\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
        expect(css).toMatch(/\.preview-stage:fullscreen\s*\{[^}]*max-height:\s*100vh[^}]*aspect-ratio:\s*9\s*\/\s*16/);
    });

    test('preview scales the actual 1080×1920 menu to its container and responds to fullscreen', () => {
        const js = read('js/menu-admin.js');
        expect(js).toContain('stage.clientWidth / 1080');
        expect(js).toContain('stage.clientHeight / 1920');
        expect(js).toContain('new ResizeObserver(fitPortraitPreview)');
        expect(js).toContain('stage.requestFullscreen()');
        expect(js).toContain('window.togglePreviewFullscreen = togglePreviewFullscreen');
    });
});
