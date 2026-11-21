/**
 * saved-views.ts — العرضات المحفوظة لسجلات النظام (نمط RegisterShell، 2026-11-21).
 * ────────────────────────────────────────────────────────────────────────────
 * مرآة لعقد التفضيلات في lib/navigation.ts (PrefStorage + قراءة آمنة بلا رمي):
 *   مفتاح التخزين: `karim:views:<viewKey>` — نفس مساحة أسماء
 *   `karim:datatable:*` (حفظ الأعمدة في ui/DataTable.tsx:201).
 *
 * العرضة = اسم + مرشّحات نصية (Record<string,string>) — الشاشة تملك الحالة
 * وتطبّق المرشّحات بنفسها عبر onApplyView؛ هنا التخزين والتحقق فقط.
 */
export const VIEWS_KEY_PREFIX = 'karim:views:';

export interface SavedView {
    /** اسم معروض عربي (≤60 حرفًا). */
    name: string;
    /** مرشّحات العرضة — قيم نصية فقط (الحالة تملك التحويل لأنواعها). */
    filters: Record<string, string>;
}

export type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_VIEWS = 12;
const MAX_FILTERS = 40;

function defaultStorage(): ViewStorage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

function sanitizeView(raw: unknown): SavedView | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 60) : '';
    if (!name) {
        return null;
    }
    const filtersRaw = record.filters;
    if (typeof filtersRaw !== 'object' || filtersRaw === null || Array.isArray(filtersRaw)) {
        return null;
    }
    const filters: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(filtersRaw as Record<string, unknown>)) {
        if (count >= MAX_FILTERS) {
            break;
        }
        if (typeof key !== 'string' || !key || key.length > 60 || typeof value !== 'string' || value.length > 200) {
            continue;
        }
        filters[key] = value;
        count += 1;
    }
    return { name, filters };
}

/** يقرأ عرضات مفتاحٍ معيّن — تالف/غائب ⇒ [] بلا رمي (نمط readNavPrefs). */
export function readSavedViews(viewKey: string, storage: ViewStorage | null = defaultStorage()): SavedView[] {
    if (!storage || !viewKey) {
        return [];
    }
    try {
        const raw = storage.getItem(VIEWS_KEY_PREFIX + viewKey);
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        const views: SavedView[] = [];
        for (const entry of parsed.slice(0, MAX_VIEWS)) {
            const view = sanitizeView(entry);
            if (view) {
                views.push(view);
            }
        }
        return views;
    } catch {
        return [];
    }
}

/** يحفظ العرضات؛ فشل التخزين صامت — العرضة تبقى في الذاكرة للجلسة. */
export function writeSavedViews(viewKey: string, views: readonly SavedView[], storage: ViewStorage | null = defaultStorage()): void {
    if (!storage || !viewKey) {
        return;
    }
    try {
        storage.setItem(VIEWS_KEY_PREFIX + viewKey, JSON.stringify(views.slice(0, MAX_VIEWS)));
    } catch {
        // تخزين معطّل/ممتلئ — لا نتدخل في مسار الشاشة.
    }
}
