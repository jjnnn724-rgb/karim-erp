/**
 * screen-document.ts — «التوأم الورقي» (2026-11-21): كل سجل في النظام له
 * ورقة A4 رسمية بنفس الهوية، مبنية بياناتًا لا بلقطة شاشة.
 *
 * المحوّل يأخذ أعمدة/صفوف السجل ومؤشراته ويبني OfficialSheetInput،
 * وprintRegisterTwin يطبعها عبر printOfficialSheet (lib/official-print.ts) —
 * نفس المحرّك الذي يخدم المطبخ والبوفيه وتكلفة الأقسام.
 */
import { printOfficialSheet, type OfficialSheetColumn, type OfficialSheetInput, type OfficialSheetKpi, type OfficialSheetSection } from './official-print';

export interface RegisterTwinColumn {
    /** مفتاح الحقل في صفوف السجل — إلزامي لربط الصف بالعمود. */
    key: string;
    header: string;
    align?: 'start' | 'center' | 'end';
    width?: string;
}

export interface RegisterTwinInput {
    /** عنوان الوثيقة العربية الرسمي. */
    title: string;
    englishTitle?: string;
    subtitle?: string;
    from?: string;
    to?: string;
    /** مؤشرات الوثيقة — نفس قيم AnswerStrip. */
    kpis?: Array<{ label: string; value: string | number; hint?: string }>;
    columns: RegisterTwinColumn[];
    /** الصفوف — مفاتيحها بأمر الأعمدة نفسه. القيم تُحول نصًّا آمنًا. */
    rows: Array<Record<string, string | number>>;
    totalsRow?: Array<string | number>;
    notes?: string[];
}

/** يحوّل أعمدة/صفوف السجل إلى مواصفة الورقة الرسمية (دوال، لا ألوان خام). */
export function registerTwinInput(input: RegisterTwinInput): OfficialSheetInput {
    const columns: OfficialSheetColumn[] = input.columns.map((column) => {
        const mapped: OfficialSheetColumn = { key: column.key, header: column.header };
        if (column.align !== undefined) {
            mapped.align = column.align;
        }
        if (column.width !== undefined) {
            mapped.width = column.width;
        }
        return mapped;
    });
    const kpis: OfficialSheetKpi[] | undefined = input.kpis?.length
        ? input.kpis.map((kpi) => {
              const mapped: OfficialSheetKpi = { label: kpi.label, value: String(kpi.value ?? '') };
              if (kpi.hint !== undefined) {
                  mapped.hint = kpi.hint;
              }
              return mapped;
          })
        : undefined;
    const sections: OfficialSheetSection[] = [
        {
            heading: input.subtitle ? `${input.title} — ${input.subtitle}` : input.title,
            columns,
            rows: input.rows.map((row) => {
                const record: Record<string, string | number> = {};
                for (const column of columns) {
                    record[column.key] = String(row[column.key] ?? '');
                }
                return record;
            }),
            ...(input.totalsRow !== undefined ? { totalsRow: input.totalsRow.map((cell) => String(cell)) } : {}),
        },
    ];
    const sheet: OfficialSheetInput = {
        title: input.title,
        sections,
        ...(kpis !== undefined ? { kpis } : {}),
    };
    if (input.englishTitle !== undefined) {
        sheet.englishTitle = input.englishTitle;
    }
    if (input.subtitle !== undefined) {
        sheet.subtitle = input.subtitle;
    }
    if (input.from !== undefined) {
        sheet.from = input.from;
    }
    if (input.to !== undefined) {
        sheet.to = input.to;
    }
    if (input.notes !== undefined) {
        sheet.notes = input.notes;
    }
    return sheet;
}

/** يطبع التوأم الورقي — نفس دورة النقرة الآمنة (نمط printOfficialSheet). */
export function printRegisterTwin(input: RegisterTwinInput): boolean {
    return printOfficialSheet(registerTwinInput(input));
}
