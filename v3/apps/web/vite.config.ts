import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * إعدادات البناء — `base: '/v3/'` لأن التطبيق يُخدَم تحت `/v3` في السيرفر
 * القديم (ADR-02: داخل Express، لا على أصلٍ آخر).
 *
 * ربط الإصدار: `scripts/frontend-version.json` هو **مصدرُ الحقيقة الوحيد**
 * لإصدار الواجهة (`backend/asset-version.js` يقرأه)، فالحزمة تُبنى بالرقم
 * نفسه ويُسجَّل في `<meta name="asset-version">`.
 *
 * استثناءٌ صريح من `?v=` (لائحة G5 تسمح به): أصول v3 مبصوصة بمحتواها
 * (`index-B4aEpyvO.js`) و`v3-static.js` يخدمها `immutable` سنةً و`index.html`
 * بـ`no-cache` — فاسم الملف نفسه هو مفتاح الكاش، أقوى من رقمٍ يدوي.
 *
 * ولا يجوز إضافة `?v=` هنا: الروابط بين الأجزاء يولّدها Rollup بلا استعلام
 * (`from"./index-*.js"`)، فلو حمل رابطُ الدخول `?v=` لصار عنوانان لوحدةٍ
 * واحدة، وقيّم المتصفح الدخولَ مرّتين — `createRoot` على `#root` مرتين،
 * والثاني يمحو حاوية الأول فتفشل `removeChild` وتظهر شاشة خطأ فارغة.
 */

const VERSION_FILE = fileURLToPath(new URL('../../../scripts/frontend-version.json', import.meta.url));

function readAssetVersion(): string {
    try {
        const parsed: unknown = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
        const version = String((parsed as { version?: string }).version ?? '').trim();
        return /^\d+(?:\.\d+)*$/.test(version) ? version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function assetVersionPlugin(version: string): Plugin {
    return {
        name: 'karim-asset-version',
        transformIndexHtml(html) {
            return html.replaceAll('%ASSET_VERSION%', version);
        },
    };
}

export default defineConfig({
    base: '/v3/',
    plugins: [assetVersionPlugin(readAssetVersion()), react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: 'dist',
        minify: 'terser',
        sourcemap: false,
        target: 'es2022',
        rollupOptions: {
            output: {
                /*
                 * تقسيم مورّدات المتصفح إلى حزم مستقلة (سلوك الشركات الكبرى):
                 * كود المورّدات (React/HeroUI/Radix/TanStack) يتغيّر نادرًا، ف；当
                 * تُبنى نسخة جديدة من التطبيق لا يعيد المتصفح تنزيله — الترقيم
                 * (hashing) يُبقي رابط الحزمة ثابتًا بين الإصدارات. كما يخرج
                 * ثقل المورّدات من حزمة الدخول فيصير أول رسم أسرع، والتنزيل
                 * متوازٍ بدل ملفٍ واحد كبير.
                 *
                 * حزمة الرسوم (recharts) تُركت تلقائيًا_chunk مستقل لأن شاشاتها
                 * محمّلة بـ lazy أصلًا — لا تُجبرها هنا على الدخول.
                 */
                /*
                 * لا تقسيم يدوي للموردين: كل محاولةٍ لفرض حزم vendor منفصلة
                 * أنشأت دورةً بين الحزم كسرت إقلاع الإنتاج بالكامل
                 * (`Cannot access 'st' before initialization`) — فالصفحة تبقى
                 * فارغة ولا تظهر بوابة الدخول. Rollup يوزّع الموردين تلقائيًا
                 * حول وحدات الدخول، والتقسيم الحقيقي قائمٌ على الشاشات الكسولة
                 * (كل شاشة وحدةٌ تُحمَّل عند الطلب) فلا تتضخم حزمة البداية.
                 */
            },
        },
    },
    server: {
        // التطوير: الواجهة على Vite، والـAPI من السيرفر القديم.
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5001',
                changeOrigin: false,
            },
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/setupTests.ts'],
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        clearMocks: true,
        restoreMocks: true,
    },
});
