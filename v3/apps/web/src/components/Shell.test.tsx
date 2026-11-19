import { describe, expect, it } from 'vitest';
import {
    DEFAULT_NAV_PREFS,
    documentTitle,
    groupForPath,
    HOME_TITLE,
    MOBILE_PRIMARY,
    NAV_GROUPS,
    NAV_PREFS_KEY,
    NAV_TITLES,
    normalizePath,
    type PrefStorage,
    readNavPrefs,
    screenKeyOf,
    titleForPath,
    writeNavPrefs,
} from '../lib/navigation';
import { V3_SCREENS } from '../lib/screens';
import { NAV_ITEMS } from './Shell';

/**
 * حارس التنقّل — يسقط إن انحرف التجميع أو العناوين عن مفاتيح `screens.ts`
 * أو عن كتلة `NAV_ITEMS` في القشرة (نفس منطق `registration.test.ts`).
 */

function memoryStorage(seed: Record<string, string> = {}): PrefStorage & { readonly value: () => string | null } {
    let stored: string | null = seed[NAV_PREFS_KEY] ?? null;
    return {
        getItem: (key: string) => (key === NAV_PREFS_KEY ? stored : null),
        setItem: (key: string, value: string) => {
            if (key === NAV_PREFS_KEY) {
                stored = value;
            }
        },
        value: () => stored,
    };
}

describe('التنقّل — سبع مجموعات', () => {
    it('سبع مجموعات بلا تكرار', () => {
        expect(NAV_GROUPS).toHaveLength(7);
        expect(new Set(NAV_GROUPS.map((group) => group.id)).size).toBe(7);
    });

    it('كل شاشة في مجموعة واحدة بالضبط (تغطية كاملة)', () => {
        const grouped = NAV_GROUPS.flatMap((group) => group.keys);
        expect(grouped).toHaveLength(V3_SCREENS.length);
        expect(new Set(grouped).size).toBe(grouped.length);
        expect([...grouped].sort()).toEqual([...V3_SCREENS].sort());
    });

    it('كتلة NAV_ITEMS تطابق المفاتيح والعناوين', () => {
        // مسارات خدمية خارج مصفوفة التكافؤ (كشك الكاشير ومصدر البيانات):
        // تُعرض في التنقّل لكن لا تقابلها شاشات V2.
        const utilityPaths = new Set(['/cashier', '/integrations']);
        const parityItems = NAV_ITEMS.filter((item) => !utilityPaths.has(item.to));
        expect(parityItems).toHaveLength(V3_SCREENS.length);
        const groupKeys = new Set(NAV_GROUPS.flatMap((group) => group.keys));
        for (const item of parityItems) {
            const key = item.to.slice(1);
            expect(groupKeys.has(key)).toBe(true);
            expect(titleForPath(item.to)).toBe(item.label);
        }
        for (const item of NAV_ITEMS.filter((entry) => utilityPaths.has(entry.to))) {
            expect(titleForPath(item.to)).toBe(item.label);
        }
    });

    it('كل عنوان في الخريطة يطابق تسمية تنقّل أو الرئيسية', () => {
        const itemTitles = new Map<string, string>(NAV_ITEMS.map((item) => [item.to, item.label]));
        for (const path of Object.keys(NAV_TITLES)) {
            const expected = path === '/' ? HOME_TITLE : itemTitles.get(path);
            expect(NAV_TITLES[path]).toBe(expected);
        }
    });

    it('كل مجموعة لها تسمية قصيرة وتسمية كاملة', () => {
        for (const group of NAV_GROUPS) {
            expect(group.label.length).toBeGreaterThan(1);
            expect(group.shortLabel.length).toBeGreaterThan(1);
            expect(group.keys.length).toBeGreaterThan(0);
        }
    });
});

describe('التنقّل — العنوان والمسار', () => {
    it('يوحّد الصيغ ويعيد / للجذر', () => {
        expect(normalizePath('/accounts/')).toBe('/accounts');
        expect(normalizePath('')).toBe('/');
        expect(normalizePath('/')).toBe('/');
        expect(screenKeyOf('/')).toBe('');
        expect(screenKeyOf('/payroll')).toBe('payroll');
    });

    it('titleForPath يعيد العنوان الصحيح أو null', () => {
        expect(titleForPath('/')).toBe(HOME_TITLE);
        expect(titleForPath('/accounts')).toBe('شجرة الحسابات');
        expect(titleForPath('/cfo')).toBe('المدير المالي');
        expect(titleForPath('/accounts/')).toBe('شجرة الحسابات');
        expect(titleForPath('/not-a-screen')).toBeNull();
    });

    it('groupForPath يربط المسار بمجموعته', () => {
        expect(groupForPath('/payroll')?.id).toBe('hr');
        expect(groupForPath('/warehouse')?.id).toBe('inventory');
        expect(groupForPath('/settings')?.id).toBe('system');
        expect(groupForPath('/')).toBeNull();
    });

    it('عنوان الوثيقة = «{الشاشة} — Karim ERP»', () => {
        expect(documentTitle(HOME_TITLE)).toBe('الرئيسية — Karim ERP');
        expect(documentTitle('الرواتب')).toBe('الرواتب — Karim ERP');
        expect(documentTitle(null)).toBe('Karim ERP');
    });

    it('الشريط السفلي: خمسة عناصر أساسية + المزيد في القشرة', () => {
        expect(MOBILE_PRIMARY).toHaveLength(5);
        expect(MOBILE_PRIMARY[0]?.key).toBeNull();
        expect(MOBILE_PRIMARY[0]?.label).toBe(HOME_TITLE);
        for (const entry of MOBILE_PRIMARY.slice(1)) {
            expect(entry.key).not.toBeNull();
            expect(titleForPath(`/${String(entry.key)}`)).toBeTruthy();
        }
    });
});

describe('التنقّل — تفضيلات الطي والوضع المضغوط', () => {
    it('يكتب ويقرأ التفضيلات', () => {
        const storage = memoryStorage();
        writeNavPrefs({ collapsed: ['finance', 'hr'], compact: true }, storage);
        expect(JSON.parse(storage.value() ?? '{}')).toEqual({ collapsed: ['finance', 'hr'], compact: true });
        expect(readNavPrefs(storage)).toEqual({ collapsed: ['finance', 'hr'], compact: true });
    });

    it('يتجاهل المجموعات المجهولة والمكرّرة', () => {
        const storage = memoryStorage({
            [NAV_PREFS_KEY]: JSON.stringify({ collapsed: ['finance', 'finance', 'ghost', 7], compact: false }),
        });
        expect(readNavPrefs(storage)).toEqual({ collapsed: ['finance'], compact: false });
    });

    it('JSON تالف أو مخزن غائب ⇒ الافتراضي بلا رمي', () => {
        expect(readNavPrefs(memoryStorage({ [NAV_PREFS_KEY]: '{' }))).toEqual(DEFAULT_NAV_PREFS);
        expect(readNavPrefs(null)).toEqual(DEFAULT_NAV_PREFS);
        expect(readNavPrefs(memoryStorage({ [NAV_PREFS_KEY]: 'null' }))).toEqual(DEFAULT_NAV_PREFS);
    });

    it('كل مجموعة قابلة للطي: مفاتيحها معرّفة', () => {
        for (const group of NAV_GROUPS) {
            expect(group.id.length).toBeGreaterThan(1);
        }
    });
});
