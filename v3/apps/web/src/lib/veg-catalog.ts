import type { VegItemInput } from './veg-requests-write';

export const VEG_UNITS = ['كجم', 'كيس', 'كرتونة'] as const;
export type VegUnit = (typeof VEG_UNITS)[number];

export interface VegCatalogItem {
    name: string;
    unit: VegUnit;
    category: string;
}

export const VEG_REQUEST_CATALOG: readonly VegCatalogItem[] = [
    { name: 'طماطم', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'خيار', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'بصل أخضر', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'باذنجان', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'بقدونس', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'شبت', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كزبرة خضراء', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كرفس', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'كرنب أبيض', unit: 'كيس', category: 'ورقيات وكرنب' },
    { name: 'كرنب أحمر', unit: 'كيس', category: 'ورقيات وكرنب' },
    { name: 'خس مدور', unit: 'كجم', category: 'ورقيات وكرنب' },
    { name: 'جزر', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'كرات بلدي', unit: 'كجم', category: 'ورقيات وأعشاب' },
    { name: 'فلفل أحمر حار', unit: 'كجم', category: 'فلفل' },
    { name: 'خس أوان', unit: 'كجم', category: 'ورقيات وكرنب' },
    { name: 'باذنجان عروس', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'باذنجان رومي', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'كوسة', unit: 'كجم', category: 'خضار أساسية' },
    { name: 'فلفل أخضر رومي', unit: 'كجم', category: 'فلفل' },
    { name: 'فلفل ألوان (أحمر وأصفر)', unit: 'كجم', category: 'فلفل' },
    { name: 'زهرة', unit: 'كجم', category: 'ورقيات وكرنب' },
    { name: 'خس بلدي', unit: 'كجم', category: 'ورقيات وكرنب' },
    { name: 'بروكلي', unit: 'كجم', category: 'ورقيات وكرنب' },
    { name: 'زنجبيل', unit: 'كرتونة', category: 'أصناف خاصة' },
    { name: 'ثوم مقشر', unit: 'كيس', category: 'أصناف خاصة' },
    { name: 'فلفل أخضر حار', unit: 'كجم', category: 'فلفل' },
    { name: 'ليمون بلدي', unit: 'كجم', category: 'أصناف خاصة' },
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
