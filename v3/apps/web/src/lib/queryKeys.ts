/**
 * مفاتيح الاستعلام — ثابتة ومحدّدة.
 *
 * «المستقرة» تعني: نفس البيانات ⇒ نفس المفتاح بالضبط، فلا يُعاد الجلب
 * ولا يختفي الكاش بين التنقّلَين. والمفتاح مصفوفة قيمٍ أوّلية (لا كائن
 * غير مرتّب) فيبقى قابلًا للتسلسل والمقارنة حرفيًا.
 */
export const queryKeys = {
    chart: ['accounting', 'chart'] as const,
    chartPage: (page: number, pageSize: number, search: string, type: string, level: number | null) =>
        ['accounting', 'chart-page', page, pageSize, search, type, level] as const,
    journal: (limit: number) => ['accounting', 'journal', limit] as const,
    journalEntry: (id: string) => ['accounting', 'journal-entry', id] as const,
};
