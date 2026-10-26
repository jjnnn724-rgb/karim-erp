/**
 * v2-legacy-sunset.test.js — شريط إيقاف الواجهة القديمة
 * ════════════════════════════════════════════════════
 * القديم يظل يعمل بكامل وظائفه، والشريط يعلوه تحذيرًا مؤقتًا يذكّر
 * بموعد الإيقاف ويفتح الواجهة الجديدة في تبويبٍ مستقل. الشريط جزء من
 * التخطيط (لا يغطي المحتوى)، ويختفي من الطباعة.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');

describe('شريط إيقاف الواجهة القديمة', () => {
    test('يعلو الصفحة ويحمل موعد الإيقاف ورابط V2', () => {
        expect(index).toContain('<body class="legacy-sunset-on">');
        expect(index).toContain('class="legacy-sunset" role="status"');
        expect(index).toContain('هذه الواجهة ستُوقف خلال شهر');
        expect(index).toContain('href="/app/v2.html?live=1"');
        expect(index).toContain('target="_blank" rel="noopener"');
        expect(index).toContain('الانتقال إلى الواجهة الجديدة');
    });

    test('الشريط يعلو كل الواجهة ولا يحجب المحتوى ولا يظهر في الطباعة', () => {
        expect(styles).toContain('body.legacy-sunset-on{--sunset-h:48px}');
        expect(styles).toContain('height:var(--sunset-h)');
        expect(styles).toContain('position:sticky;top:0;z-index:9600');
        expect(styles).toContain('body.legacy-sunset-on #app{height:calc(100vh - var(--sunset-h))}');
        expect(styles).toContain('body.legacy-sunset-on .app-layout{height:100%}');
        expect(styles).toContain('body.legacy-sunset-on #login{padding-top:calc(20px + var(--sunset-h))}');
        expect(styles).toContain('@media print{body.legacy-sunset-on .legacy-sunset{display:none!important}');
        expect(styles).toContain('body.legacy-sunset-on{--sunset-h:70px}');
    });
});
