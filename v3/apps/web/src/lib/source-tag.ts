/**
 * وسم مصدر البيانات — عقدٌ مرئي لحدود المصادر
 * (`docs/modernization/V3-DATA-BOUNDARIES.md`).
 *
 * PostgreSQL الخاص بـKarimERP هو السجل الرسمي. وما يُقرأ من مرآة YaraSoft
 * داخل PostgreSQL (`ys_mirror_orders` وأخواتها) **ليس** سجل مبيعات رسمي:
 * هو بيانات انتقالٍ مرآية تُعرض بوصفها كذلك — باسم المصدر ووقت المزامنة،
 * فلا تختلط بالمبيعات المحلية في جدولٍ واحد بلا تمييز.
 *
 * القاعدة في الواجهة: كل شاشة تقرأ مرآة خارجية **تعلن** ذلك في رأسها
 * بنصٍّ صريح («مصدر: مرآة YaraSoft — بيانات انتقال»)، وكل صفٍّ يحمل
 * وسومَ مصدره في العرض لا في الخفاء.
 */

/** مصدر السجل — KarimERP رسمي، أو مرآة خارجية. */
export type SourceKind = 'karim-erp' | 'yara-soft-mirror' | 'oracle-mirror';

export const SOURCE_LABELS: Record<SourceKind, { ar: string; en: string }> = {
    'karim-erp': { ar: 'KarimERP', en: 'KarimERP' },
    'yara-soft-mirror': { ar: 'مرآة YaraSoft', en: 'YaraSoft mirror' },
    'oracle-mirror': { ar: 'مرآة Oracle', en: 'Oracle mirror' },
};

/** نصّ الإعلان الثابت فوق الشاشة — لا يُخفى ولا يُلخّص. */
export const MIRROR_SOURCE_NOTICE =
    'مصدر البيانات: مرآة YaraSoft (بيانات انتقال) — ليست سجل مبيعات KarimERP الرسمي، ولا تُجمع مع المبيعات المحلية بلا تسوية معلنة.';

/** نصّ الإعلان للشاشات التي تقرأ مصدر KarimERP الرسمي — إيجاز للشفافية. */
export const OFFICIAL_SOURCE_NOTICE = 'مصدر البيانات: سجل KarimERP الرسمي داخل PostgreSQL.';

/**
 * هل هذا المصدر مرآة خارجية؟ — القاعدة التي تحكم العرض والإقرار.
 */
export function isMirrorSource(kind: SourceKind): boolean {
    return kind !== 'karim-erp';
}

/**
 * وسم مصدر صفٍّ واحد — يُعرض بجوار اسم البند أو المحور.
 * المرآة تُوسم دائمًا بالنصّ الكامل، فلا يوهم الرقم أنه رسمي.
 */
export function sourceLabel(kind: SourceKind): string {
    const label = SOURCE_LABELS[kind];
    return isMirrorSource(kind) ? `${label.ar} — انتقال` : label.ar;
}

/**
 * نصّ مصدرٍ مع وقت المزامنة حين توفّره الخوادم (حقل `synced_at` أو
 * `mirror_synced_at` في جسم الاستجابة). الغياب يُعرض كـ«غير محدد» — لا
 * يُخترع وقت.
 */
export function syncedAtLabel(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return 'وقت المزامنة غير محدد';
    }
    return `آخر مزامنة: ${raw}`;
}
