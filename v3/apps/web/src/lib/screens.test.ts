import { describe, expect, it } from 'vitest';
import { enabledScreens, firstEnabledScreen, isScreenEnabled, LEGACY_APP_URL, V3_SCREENS } from './screens';

function docWith(content: string | null): Document {
    const doc = document.implementation.createHTMLDocument('screens');
    if (content !== null) {
        const meta = doc.createElement('meta');
        meta.name = 'v3-screens';
        meta.content = content;
        doc.head.appendChild(meta);
    }
    return doc;
}

describe('مفاتيح الشاشات', () => {
    it('غياب الوسم = كل الشاشات (تطوير/اختبار بلا سيرفر يحقن)', () => {
        expect([...enabledScreens(docWith(null))]).toEqual([...V3_SCREENS]);
        expect(firstEnabledScreen(docWith(null))).toBe('accounts');
    });

    it('الوسم يقصر المفعّل على المعلَن وحده', () => {
        const doc = docWith('accounts');
        expect([...enabledScreens(doc)]).toEqual(['accounts']);
        expect(isScreenEnabled('accounts', doc)).toBe(true);
        expect(isScreenEnabled('journal', doc)).toBe(false);
        expect(firstEnabledScreen(doc)).toBe('accounts');
    });

    it('أول شاشة مفعّلة تتبع ترتيب v3 لا ترتيب النص', () => {
        expect(firstEnabledScreen(docWith('journal'))).toBe('journal');
        expect(firstEnabledScreen(docWith('journal,accounts'))).toBe('accounts');
    });

    it('وسم حاضر بلا أسماء ⇒ لا شاشة ⇒ القديم', () => {
        expect(firstEnabledScreen(docWith(''))).toBeNull();
        expect(firstEnabledScreen(docWith(' , '))).toBeNull();
    });

    it('مسار الرجوع محلي دائمًا', () => {
        expect(LEGACY_APP_URL.startsWith('/')).toBe(true);
        expect(LEGACY_APP_URL.startsWith('//')).toBe(false);
    });
});
