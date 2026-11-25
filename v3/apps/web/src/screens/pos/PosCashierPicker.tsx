/**
 * PosCashierPicker — اختيار «الكاشير» عند فتح الوردية، مرتّبًا حسب القسم.
 * ═══════════════════════════════════════════════════════════════════════════════
 * سبب وجوده (طلب المالك): قائمة الأقسام كانت مختلطة («مبيعات كاشير 4» بجوار
 * «قسم الخباز»…) فيخلط الكاشير ويبيع في قسم غير قسمه. الآن:
 *   • كل قسم يظهر كعنوان واضح، وتحته أرقام كاشيراته بالترتيب.
 *   • الضغط على رقم الكاشير يفتح الوردية على قسمه بالضبط (erp_ys_cc_N) — فكل
 *     بيعة تُنسب لقسمها تلقائيًا (ربط erp_ys_cc_N → ys_cc_N في الإيراد).
 *   • الأقسام بلا كاشير مُجمّعة أسفل «أقسام أخرى».
 */
import { useMemo } from 'react';
import type { DeptCashierLink, PosDepartment } from '../../lib/pos';

export interface PosCashierGroup {
    /** كود القسم الأم (مثل external_sales) */
    readonly deptCode: string;
    /** اسم القسم المعروض */
    readonly title: string;
    /** رقم قسم POS الخاص بالقسم (id) — يُستخدم لو اختار القسم بلا كاشير */
    readonly departmentId: string;
    readonly cashiers: readonly {
        readonly no: string;
        /** id قسم POS الخاص بالكاشير (erp_ys_cc_N) — null لو غير موجود */
        readonly departmentId: string | null;
        readonly primary: boolean;
    }[];
}

export interface PosCashierPickerProps {
    readonly departments: readonly PosDepartment[];
    readonly links: readonly DeptCashierLink[];
    readonly selectedId: string;
    readonly onSelect: (departmentId: string) => void;
    readonly busy: boolean;
    readonly disabled: boolean;
}

/** كود قسم POS الذي يخص كاشيرًا معيّنًا: erp_ys_cc_4 */
export function cashierDeptCode(cashierNo: string): string {
    return `erp_ys_cc_${String(cashierNo).trim()}`;
}

export function buildCashierGroups(
    departments: readonly PosDepartment[],
    links: readonly DeptCashierLink[],
): { groups: PosCashierGroup[]; others: PosCashierGroup[] } {
    const byPosCode = new Map<string, PosDepartment>();
    for (const d of departments) {
        byPosCode.set(String(d.code).toLowerCase(), d);
    }

    const groups = new Map<string, PosCashierGroup>();
    const sortedLinks = [...links].sort((a, b) => {
        const an = Number(a.cashier_no);
        const bn = Number(b.cashier_no);
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) { return an - bn; }
        return String(a.cashier_no).localeCompare(String(b.cashier_no), 'en', { numeric: true });
    });

    for (const link of sortedLinks) {
        const deptCode = String(link.dept_code || '').trim();
        if (!deptCode) { continue; }
        const groupDept = byPosCode.get(`erp_${deptCode.toLowerCase()}`);
        const cashierDept = byPosCode.get(cashierDeptCode(String(link.cashier_no ?? '')));
        const existing = groups.get(deptCode);
        const entry = {
            no: String(link.cashier_no).trim(),
            departmentId: cashierDept ? String(cashierDept.id) : null,
            primary: link.is_primary === true || link.is_primary === '1' || link.is_primary === 1,
        };
        if (existing) {
            groups.set(deptCode, { ...existing, cashiers: [...existing.cashiers, entry] });
        } else {
            groups.set(deptCode, {
                deptCode,
                title: groupDept?.name_ar || groupDept?.name_en || deptCode,
                departmentId: groupDept ? String(groupDept.id) : (cashierDept ? String(cashierDept.id) : ''),
                cashiers: [entry],
            });
        }
    }

    const usedDeptIds = new Set<string>();
    for (const g of groups.values()) {
        usedDeptIds.add(g.departmentId);
        for (const c of g.cashiers) { if (c.departmentId) { usedDeptIds.add(c.departmentId); } }
    }

    const others: PosCashierGroup[] = departments
        .filter((d) => d.is_active !== false && !usedDeptIds.has(String(d.id)))
        .filter((d) => !String(d.code).toLowerCase().startsWith('erp_ys_cc_'))
        .map((d) => ({
            deptCode: String(d.code),
            title: d.name_ar || d.name_en || String(d.code),
            departmentId: String(d.id),
            cashiers: [],
        }));

    const order = ['external_sales', 'caf', 'open_buffet', 'g', 'b.f', 'b_f'];
    const list = [...groups.values()].sort((a, b) => {
        const ai = order.indexOf(a.deptCode.toLowerCase());
        const bi = order.indexOf(b.deptCode.toLowerCase());
        if (ai !== -1 && bi !== -1) { return ai - bi; }
        if (ai !== -1) { return -1; }
        if (bi !== -1) { return 1; }
        return a.title.localeCompare(b.title, 'ar');
    });

    return { groups: list, others };
}

export function PosCashierPicker({ departments, links, selectedId, onSelect, busy, disabled }: PosCashierPickerProps) {
    const { groups, others } = useMemo(() => buildCashierGroups(departments, links), [departments, links]);

    const renderGroup = (group: PosCashierGroup) => (
        <section key={group.deptCode} className="pos-cashier-pick__group">
            <h3 className="pos-cashier-pick__title">{group.title}</h3>
            <div className="pos-cashier-pick__chips">
                {group.cashiers.map((cashier) => {
                    const target = cashier.departmentId ?? group.departmentId;
                    const isSelected = target !== '' && target === selectedId;
                    return (
                        <button
                            key={cashier.no}
                            type="button"
                            className={`pos-cashier-pick__chip${isSelected ? ' is-active' : ''}`}
                            disabled={busy || disabled || !target}
                            aria-pressed={isSelected}
                            onClick={() => {
                                if (target) { onSelect(target); }
                            }}
                        >
                            <span className="pos-cashier-pick__no">كاشير {cashier.no}</span>
                            {cashier.primary ? <span className="pos-cashier-pick__tag">رئيسي</span> : null}
                        </button>
                    );
                })}
                {group.cashiers.length === 0 ? (
                    <button
                        type="button"
                        className={`pos-cashier-pick__chip${group.departmentId === selectedId ? ' is-active' : ''}`}
                        disabled={busy || disabled || !group.departmentId}
                        aria-pressed={group.departmentId === selectedId}
                        onClick={() => {
                            if (group.departmentId) { onSelect(group.departmentId); }
                        }}
                    >
                        <span className="pos-cashier-pick__no">قسم فقط</span>
                    </button>
                ) : null}
            </div>
        </section>
    );

    return (
        <div className="pos-cashier-pick" role="group" aria-label="اختيار الكاشير">
            {groups.map(renderGroup)}
            {others.length ? (
                <section className="pos-cashier-pick__group pos-cashier-pick__group--others">
                    <h3 className="pos-cashier-pick__title">أقسام أخرى (بدون كاشير)</h3>
                    <div className="pos-cashier-pick__chips">
                        {others.map((group) => (
                            <button
                                key={group.departmentId}
                                type="button"
                                className={`pos-cashier-pick__chip${group.departmentId === selectedId ? ' is-active' : ''}`}
                                disabled={busy || disabled}
                                aria-pressed={group.departmentId === selectedId}
                                onClick={() => onSelect(group.departmentId)}
                            >
                                <span className="pos-cashier-pick__no">{group.title}</span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}
