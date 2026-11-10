/**
 * دمج أصناف CSS — بلا تبعية خارجية (`clsx`/`tailwind-merge` غير مطلوبتين).
 * القيم الكاذبة تُهمَل؛ الأصناف لا تُعاد ترتيبها ولا تُدمج (المكوّنات تُسلّم
 * أصنافًا متعارضة بترتيب مقصود، و`tailwind-merge` تخمين لا نريد الاعتماد عليه).
 */

export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
    const classes: string[] = [];
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0) {
            classes.push(value);
        }
    }
    return classes.join(' ');
}
