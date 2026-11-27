import type { VegItemInput } from './veg-requests-write';

/**
 * مرآة الواجهة لكاتالوج السيرفر (backend/veg-requests-logic.js).
 * النسخة المعتمدة: «طلبية الخضروات والأعشاب» — 30 صنفًا رئيسيًا + 5 أصناف إضافية،
 * وكل الأصناف الإضافية بوحدة «كجم» (قرار المالك 2026-11-27).
 */
export const VEG_UNITS = ['كجم', 'كيس', 'كرتونة'] as const;
export type VegUnit = (typeof VEG_UNITS)[number];

export interface VegCatalogItem {
    name: string;
    unit: VegUnit;
    category: string;
}

export const VEG_REQUEST_CATALOG: readonly VegCatalogItem[] = [
    // ── 30 صنفًا رئيسيًا ──────────────────────────────────────────────────
    { name: 'طماطم', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'خيار', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'بصل أحمر', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'بطاطس', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'كوسة', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'باذنجان عروس', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'باذنجان رومي', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'زهرة', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'بروكلي', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'جزر', unit: 'كجم', category: 'خضار أساسية' },

    { name: 'بقدونس', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'شبت', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كزبرة خضراء', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كرفس', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'خس مدور', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'جرجير', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كرات بلدي', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'خس ألوان', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'خس بلدي', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'نعناع', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'بصل أخضر', unit: 'كجم', category: 'ورقيات وأعشاب' },

    { name: 'كرنب أبيض', unit: 'كيس', category: 'كرنب وفلفل' },
    { name: 'كرنب أحمر', unit: 'كيس', category: 'كرنب وفلفل' },
    { name: 'فلفل أحمر حار', unit: 'كجم', category: 'كرنب وفلفل' },
    { name: 'فلفل أخضر رومي', unit: 'كجم', category: 'كرنب وفلفل' },
    { name: 'فلفل ألوان (أحمر وأصفر)', unit: 'كجم', category: 'كرنب وفلفل' },
    { name: 'فلفل أخضر حار', unit: 'كجم', category: 'كرنب وفلفل' },

    { name: 'زنجبيل', unit: 'كرتونة', category: 'أصناف خاصة' },
    { name: 'ثوم مقشر', unit: 'كيس', category: 'أصناف خاصة' },
    { name: 'ليمون بلدي', unit: 'كجم', category: 'أصناف خاصة' },

    // ── 5 أصناف إضافية ───────────────────────────────────────────────────
    { name: 'طماطم شيري', unit: 'كجم', category: 'أصناف إضافية' },
    { name: 'زعتر فريش', unit: 'كجم', category: 'أصناف إضافية' },
    { name: 'بقدونس فرنسي', unit: 'كجم', category: 'أصناف إضافية' },
    { name: 'دبة', unit: 'كجم', category: 'أصناف إضافية' },
    { name: 'فرع بلدي', unit: 'كجم', category: 'أصناف إضافية' },
];

export const VEG_CATALOG_CATEGORIES = ['الكل', ...new Set(VEG_REQUEST_CATALOG.map((item) => item.category))];

export function vegItemsFromQuantities(
    quantities: Readonly<Record<string, string>>,
    units: Readonly<Record<string, string>>,
): VegItemInput[] {
    return VEG_REQUEST_CATALOG.flatMap((item) => {
        const quantity = Number(quantities[item.name] ?? '');
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return [];
        }
        return [{ name: item.name, qty: quantity, unit: units[item.name] || item.unit }];
    });
}
