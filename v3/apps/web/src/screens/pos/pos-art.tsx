import type { ReactElement } from 'react';

export type ArtFamily =
    | 'skewer'
    | 'drumstick'
    | 'fish'
    | 'utensils'
    | 'burger'
    | 'pizza'
    | 'soup'
    | 'salad'
    | 'eggs'
    | 'fries'
    | 'coffee'
    | 'tea'
    | 'juice'
    | 'soda'
    | 'milk'
    | 'water'
    | 'bread'
    | 'sweets'
    | 'dessert'
    | 'kabsa'
    | 'biryani'
    | 'shawarma'
    | 'cloche'
    | 'cake'
    | 'noodles'
    | 'generic';

export interface ArtStyle {
    /** تدرج الخلفية (in hex, تُحقن كـ CSS gradients). */
    from: string;
    to: string;
    /** لون النقش داخل الأيقونة. */
    glyph: string;
}

export const ART_STYLES: Record<ArtFamily, ArtStyle> = {
    skewer: { from: '#f97316', to: '#c2410c', glyph: '#fff' },
    drumstick: { from: '#f59e0b', to: '#b45309', glyph: '#fff' },
    fish: { from: '#38bdf8', to: '#075985', glyph: '#fff' },
    utensils: { from: '#64748b', to: '#0f172a', glyph: '#fff' },
    burger: { from: '#eab308', to: '#a16207', glyph: '#fff' },
    pizza: { from: '#fb923c', to: '#c2410c', glyph: '#fff' },
    soup: { from: '#fbbf24', to: '#b45309', glyph: '#fff' },
    salad: { from: '#34d399', to: '#065f46', glyph: '#fff' },
    eggs: { from: '#eab308', to: '#a16207', glyph: '#fff' },
    fries: { from: '#fbbf24', to: '#a16207', glyph: '#fff' },
    coffee: { from: '#a16207', to: '#431407', glyph: '#fff' },
    tea: { from: '#f59e0b', to: '#78350f', glyph: '#fff' },
    juice: { from: '#22d3ee', to: '#0e7490', glyph: '#fff' },
    soda: { from: '#475569', to: '#0f172a', glyph: '#fff' },
    milk: { from: '#e2e8f0', to: '#94a3b8', glyph: '#1f2937' },
    water: { from: '#38bdf8', to: '#0369a1', glyph: '#fff' },
    bread: { from: '#fbbf24', to: '#92400e', glyph: '#fff' },
    sweets: { from: '#fb7185', to: '#881337', glyph: '#fff' },
    dessert: { from: '#f472b6', to: '#9d174d', glyph: '#fff' },
    kabsa: { from: '#d97706', to: '#78350f', glyph: '#fff' },
    biryani: { from: '#ca8a04', to: '#713f12', glyph: '#fff' },
    shawarma: { from: '#ef4444', to: '#991b1b', glyph: '#fff' },
    cloche: { from: '#64748b', to: '#0f172a', glyph: '#fff' },
    cake: { from: '#fb7185', to: '#9f1239', glyph: '#fff' },
    noodles: { from: '#f59e0b', to: '#92400e', glyph: '#fff' },
    generic: { from: '#475569', to: '#1e293b', glyph: '#fff' },
};

const FAMILY_TOKENS: Array<[ArtFamily, string[]]> = [
    ['kabsa', ['كبسة', 'كبسه', 'kabsa']],
    ['biryani', ['برياني', 'بريان', 'biryani']],
    ['shawarma', ['شاورما', 'shawarma']],
    ['skewer', ['مشوي', 'مشويات', 'مشوية', 'مشاوي', 'grill', 'mixed']],
    ['skewer', ['كفتة', 'كفته', 'kebab', 'كباب']],
    ['drumstick', ['دجاج', 'فراخ', 'chicken', 'بروستد', 'زنجر', 'crispy']],
    ['fish', ['سمك', 'fish', 'جمبري', 'shrimp', 'seafood', 'كالاماري', 'كاليماري', 'روبيان', 'تونة']],
    ['utensils', ['ستيك', 'steak', 'لحم', 'ضاني', 'lamb', 'مندي', 'زربيان', 'sword']],
    ['burger', ['برجر', 'burger', 'ساندوتش', 'سندوتش', 'sandwich', 'توست', 'toast']],
    ['pizza', ['بيتزا', 'pizza']],
    ['soup', ['شوربة', 'شوربه', 'soup', 'عدس']],
    ['salad', ['سلطة', 'salad', 'تبولة', 'tabbouleh', 'حمص', 'hummus', 'متبل', 'بابا غنوج', 'فتوش', 'خضار']],
    ['eggs', ['بيض', 'egg', 'شكشوكة', 'فطور', 'إفطار', 'افطار', 'breakfast', 'فول']],
    ['fries', ['بطاطس', 'fries', 'شيبس', 'chips', 'سمبوسة', 'سمبوسك', 'samosa']],
    ['coffee', ['قهوة', 'كوفي', 'coffee', 'نسكافيه', 'لاتيه', 'موكا', 'كابتشينو', 'اسبريسو', 'كرك']],
    ['tea', ['شاي', 'tea']],
    ['juice', ['عصير', 'juice', 'orange', 'برتقال', 'مانجو', 'أناناس', 'افوكادو', 'أفوكادو', 'فراولة', 'توت']],
    ['soda', ['صودا', 'كولا', 'بيبسي', 'سفن', 'sprite', 'coca', 'pepsi', 's7']],
    ['milk', ['حليب', 'لبن', 'milk', 'laban', 'susul', 'segar']],
    ['water', ['ماء', 'مياه', 'water']],
    ['bread', ['كرواسون', 'croissant', 'رغيف', 'خبز', 'فطيرة', 'معجنات', 'فطور مخبوز', 'فخار']],
    [
        'sweets',
        [
            'كنافة',
            'كنافه',
            'قطايف',
            'بسبوسة',
            'بقلاوة',
            'معمول',
            'لقمة',
            'طرمبة',
            'بلح طرمبة',
            'kunafa',
            'qatayef',
            'basbousa',
            'baklava',
            'luqaimat',
        ],
    ],
    ['dessert', ['كيك', 'cake', 'حلى', 'حلويات', 'dessert', 'تورتة', 'كريم', 'كرمل', 'تشيز', 'cheese', 'آيس', 'ايس كريم', 'vanilla']],
    ['cloche', ['بوفيه', 'buffet', 'set']],
    [
        'noodles',
        [
            'nasi',
            'sate',
            'ayam',
            'kerupuk',
            'telud',
            'coto',
            'mie',
            'soto',
            'rendang',
            'gulai',
            'sambal',
            'noodle',
            'pasta',
            'مكرونة',
            'باستا',
            'نودلز',
        ],
    ],
    ['kabsa', ['رز', 'أرز', 'rice', 'برياني']],
];

/** يحدد عائلة الطبق من اسم الصنف (عربي/إنجليزي)؛ الوشاح generic احتياطي. */
export function familyOfProduct(name: string, nameEn = '', category = ''): ArtFamily {
    const hay = `${name} ${nameEn} ${category}`.toLowerCase();
    for (const [family, tokens] of FAMILY_TOKENS) {
        if (tokens.some((token) => hay.includes(token.toLowerCase()))) {
            return family;
        }
    }
    return 'generic';
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** مسار SVG لكل عائلة — 24×24 نظيف، مقروء حتى 20px. */
export const FAMILY_PATHS: Record<ArtFamily, ReactElement> = {
    skewer: (
        <>
            <path {...STROKE} d="M4 4 20 20" />
            <path {...STROKE} d="m8.2 8.2 1.6 1.6M11.5 11.5l1.8 1.8M14.8 14.8l1.6 1.6" />
            <circle {...STROKE} cx="17" cy="7" r="2.6" />
            <path {...STROKE} d="M17 4.4v-1.4M19.6 7h1.4M17 9.6v1.4" />
        </>
    ),
    drumstick: (
        <>
            <circle {...STROKE} cx="9.5" cy="9.5" r="5.6" />
            <path {...STROKE} d="m13.5 13.5 6 6" />
            <circle {...STROKE} cx="17.4" cy="17.4" r="1.1" />
            <circle {...STROKE} cx="19.5" cy="15.3" r="1.1" />
        </>
    ),
    fish: (
        <>
            <path {...STROKE} d="M4 12c2.5-3.6 6-5.2 9.5-5.2 3.4 0 6.2 2.4 6.5 5.2-.3 2.8-3.1 5.2-6.5 5.2S6.5 15.6 4 12z" />
            <path {...STROKE} d="M20 12l2-3M20 12l2 3" />
            <circle cx="15.6" cy="12" r=".7" fill="currentColor" />
        </>
    ),
    utensils: (
        <>
            <path {...STROKE} d="M7 3v6a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2V3" />
            <path {...STROKE} d="M9 11v10" />
            <path {...STROKE} d="M17 3a6.5 6.5 0 0 0-2.5 5c0 2.2 1.2 3 2.5 3.2V21" />
        </>
    ),
    burger: (
        <>
            <path {...STROKE} d="M5 12a7 5.5 0 0 1 14 0" />
            <path {...STROKE} d="M4 12h16M6 15h12" />
            <path {...STROKE} d="M6 18h12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3" />
        </>
    ),
    pizza: (
        <>
            <path {...STROKE} d="M12 3 4.5 19.2A9.5 9.5 0 0 0 19.5 19.2L12 3z" />
            <circle {...STROKE} cx="12" cy="8.6" r=".9" />
            <circle {...STROKE} cx="10.3" cy="13.6" r=".9" />
            <circle {...STROKE} cx="13.7" cy="13.4" r=".9" />
        </>
    ),
    soup: (
        <>
            <path {...STROKE} d="M4 12.5h16a8 8 0 0 1-16 0z" />
            <path {...STROKE} d="M9.5 9c1-1.4-1-2 0-3.4M14 9c1-1.4-1-2 0-3.4" />
            <path {...STROKE} d="M8.5 20h7" />
        </>
    ),
    salad: (
        <>
            <path {...STROKE} d="M5 11.5h14a7 7 0 0 1-14 0z" />
            <path {...STROKE} d="M12 11.5c0-2.2 1-4.2 3-5.2M9 11.5c0-1.6.8-3.2 2.3-4M15 11.5c0-1.6-.8-3.2-2.3-4" />
        </>
    ),
    eggs: (
        <>
            <circle {...STROKE} cx="12" cy="12" r="8" />
            <circle {...STROKE} cx="12" cy="12" r="2.6" />
        </>
    ),
    fries: (
        <>
            <path {...STROKE} d="M7 9.5l1.4 10a2 2 0 0 0 2 1.9h3.2a2 2 0 0 0 2-1.9L17 9.5" />
            <path {...STROKE} d="M9.3 9.5V4.5h1.3v5M12 9.5v-6h1.3v6M14.7 9.5V5h1.3v4.5" />
        </>
    ),
    coffee: (
        <>
            <path {...STROKE} d="M4 10.5h13V13a6 6 0 0 1-13 0v-2.5z" />
            <path {...STROKE} d="M17 11.5h2a2 2 0 0 1 0 4h-2" />
            <path {...STROKE} d="M8.2 8c1-1.4-1-2 0-3.4M13 8c1-1.4-1-2 0-3.4" />
        </>
    ),
    tea: (
        <>
            <path {...STROKE} d="M7 4.5h10L15 14a3.3 3.3 0 0 1-6 0L7 4.5z" />
            <path {...STROKE} d="M8.6 8.5h6.8M9 12h6" />
        </>
    ),
    juice: (
        <>
            <path {...STROKE} d="M7 4.5h10L15.9 16a3.4 3.4 0 0 1-7.8 0L7 4.5z" />
            <path {...STROKE} d="M12.6 4.5 16 1.5" />
            <circle {...STROKE} cx="12.5" cy="13" r="2.1" />
        </>
    ),
    soda: (
        <>
            <rect {...STROKE} x="8.3" y="3" width="7.4" height="18" rx="2.1" />
            <path {...STROKE} d="M8.3 8.2h7.4M8.3 15.8h7.4M11 3h2" />
        </>
    ),
    milk: (
        <>
            <path {...STROKE} d="M8 4.5h8L15 17a3 3 0 0 1-6 0L8 4.5z" />
            <path {...STROKE} d="M8 9.5h8" />
        </>
    ),
    water: (
        <>
            <path {...STROKE} d="M12 3s6.4 6.8 6.4 11.2a6.4 6.4 0 0 1-12.8 0C5.6 9.8 12 3 12 3z" />
        </>
    ),
    bread: (
        <>
            <path {...STROKE} d="M5 9.5c4-3.8 10-3.8 14 0 0 6-3.2 8.8-7 8.8S5 15.5 5 9.5z" />
            <path {...STROKE} d="M8.5 9.8c.9 2 .9 4.6 0 6.4M12 8.8v7.4M15.5 9.8c-.9 2-.9 4.6 0 6.4" />
        </>
    ),
    sweets: (
        <>
            <path {...STROKE} d="M5 11h14M5 15h14M5 19h14" />
            <path {...STROKE} d="M8 11c0-3.3 1.8-5 4-5s4 1.7 4 5" />
        </>
    ),
    dessert: (
        <>
            <path {...STROKE} d="M8.5 12h7L14 18a2.3 2.3 0 0 1-4 0L8.5 12z" />
            <circle {...STROKE} cx="12" cy="8" r="3" />
            <path {...STROKE} d="M9.5 5.3 8.2 4M12 4V2M14.5 5.3 15.8 4" />
        </>
    ),
    kabsa: (
        <>
            <path {...STROKE} d="M5 12h14a7 7 0 0 1-14 0z" />
            <path {...STROKE} d="M9 12a3 3 0 0 1 6 0M12 9V6" />
            <path {...STROKE} d="M7.5 15.5h9M9 19h6" />
        </>
    ),
    biryani: (
        <>
            <path {...STROKE} d="M6 10h12v3.5a6 6 0 0 1-12 0V10z" />
            <path {...STROKE} d="M8 10c0-3.3 1.8-5 4-5s4 1.7 4 5" />
            <path {...STROKE} d="M11 10V7.4M13.5 10V8" />
        </>
    ),
    shawarma: (
        <>
            <path {...STROKE} d="M10 3h4M10.8 3v13.5a2.2 2.2 0 0 1-2.3 2.2M13.2 3v13.5a2.2 2.2 0 0 0 2.3 2.2" />
            <path {...STROKE} d="M10.8 9h2.4M10.8 13h2.4" />
        </>
    ),
    cloche: (
        <>
            <path {...STROKE} d="M4 13.5h16a8 8 0 0 0-16 0z" />
            <path {...STROKE} d="M12 5.5v1.6M9.2 5.5h5.6" />
            <path {...STROKE} d="M3 17.5h18" />
        </>
    ),
    cake: (
        <>
            <path {...STROKE} d="M6 14.5 12 6l6 8.5V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3.5z" />
            <path {...STROKE} d="M12 10.5V20" />
            <circle {...STROKE} cx="12" cy="4.4" r=".9" />
        </>
    ),
    noodles: (
        <>
            <path {...STROKE} d="M4 11.5c2-1.4 4-1.4 6 0s4 1.4 6 0 3-1 4-.5M4 15.5c2-1.4 4-1.4 6 0s4 1.4 6 0 3-1 4-.5" />
            <path {...STROKE} d="M14.5 6.5l6-2.7M16.8 9.3l5.5-2.3" />
        </>
    ),
    generic: (
        <>
            <path {...STROKE} d="M7 3v6a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2V3M9 11v10" />
            <path {...STROKE} d="M17 3a6 6 0 0 0-2 4.8c0 2 1 3 2 3.2V21" />
        </>
    ),
};

/** بطاقة الرسم: خلفية تدرج العائلة + أيقونة الطبق البيضاء. */
export function ProductArt({ item }: { item: { name: string; nameEn?: string | undefined; category: string } }) {
    const family = familyOfProduct(item.name, item.nameEn ?? '', item.category);
    const art = ART_STYLES[family];
    const gradient = `linear-gradient(160deg, ${art.from} 0%, ${art.to} 100%)`;
    return (
        <span className="pos-product__art" style={{ background: gradient }} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="pos-product__art-icon" color={art.glyph} width="40%" height="40%" focusable="false">
                {FAMILY_PATHS[family]}
            </svg>
        </span>
    );
}
