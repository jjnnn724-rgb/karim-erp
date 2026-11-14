import {
    fetchComplianceHealth,
    fetchComplianceOutbox,
    fetchComplianceEvents,
    setComplianceProviderEnabled,
    retryComplianceRow,
    reviewComplianceRow,
    fetchWpsRequirements,
    fetchWpsReadiness,
    saveEmployeeBank,
    generateWpsSheet,
    fetchGosiRates,
    fetchGosiPreview,
    fetchQiwaReadiness,
} from '../data/integration-repo.js?v=4.9.331';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function prevMonth() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const BLOCK_LABEL = {
    EMPLOYER_ID_MISSING: 'السجل التجاري للمنشأة غير مضبوط',
    PAYROLL_MONTH_NOT_POSTED: 'لا مسير رواتب مُقفل لهذا الشهر',
    EMPLOYEES_MISSING_ID: 'موظفون بلا هوية/إقامة صحيحة',
    EMPLOYEES_MISSING_SALARY: 'موظفون بلا راتب أساسي',
    EMPLOYEES_MISSING_IBAN: 'موظفون بلا IBAN صحيح',
    EMPLOYEES_NATIONALITY_UNKNOWN: 'جنسية غير محددة',
    PAYROLL_LINES_MISSING: 'بنود مسير ناقصة لبعض الموظفين',
};

const REQ_TONE = { DONE: 'success', TODO: 'warning', PARTIAL: 'warning', MISSING: 'danger', BLOCKED: 'danger' };
const REQ_LABEL = { DONE: 'مكتمل', TODO: 'ناقص', PARTIAL: 'جزئي', MISSING: 'غير مبني', BLOCKED: 'محظور' };

const ISSUE_LABEL = {
    ID_MISSING: 'هوية ناقصة',
    SALARY_MISSING: 'راتب ناقص',
    IBAN_MISSING: 'IBAN ناقص',
    NATIONALITY_UNKNOWN: 'جنسية مجهولة',
    PAYROLL_LINE_MISSING: 'بند مسير ناقص',
};

function statusBadge(status) {
    return `<span class="erp-badge" data-tone="${REQ_TONE[status] || 'neutral'}">${REQ_LABEL[status] || esc(status)}</span>`;
}

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TONE = { VERIFIED: 'success', INFERRED: 'warning', UNVERIFIED: 'neutral', BLOCKED: 'danger' };
const LABEL = { VERIFIED: 'موثّق', INFERRED: 'مستنتج', UNVERIFIED: 'غير موثّق', BLOCKED: 'محظور' };

function fmtDate(value) {
    if (!value) {return '—';}
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {return '—';}
    try {return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(d);}
    catch {return d.toISOString().slice(0, 16).replace('T', ' ');}
}

function ageText(seconds) {
    const s = Number(seconds) || 0;
    if (s < 60) {return `${s} ث`;}
    if (s < 3600) {return `${Math.floor(s / 60)} د`;}
    return `${Math.floor(s / 3600)} س`;
}

function grantsOf(ctx) {
    const live = typeof window !== 'undefined' && window.STATE && window.STATE.permissions;
    const list = live && Array.isArray(live.grants) ? live.grants : (Array.isArray(ctx.grants) ? ctx.grants : []);
    return new Set(list);
}

export function mountComplianceSection(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const grants = grantsOf(ctx);
    const isAdmin = ctx.role === 'admin';
    const canSettings = isAdmin || grants.has('compliance.configure');
    const canSubmit = isAdmin || grants.has('compliance.submit');
    const canReview = isAdmin || grants.has('compliance.review');

    let data = null;
    let dead = [];
    let events = [];
    let busy = false;

    let month = prevMonth();
    let wpsReq = null;
    let wps = null;
    let wpsErr = '';
    let rates = null;
    let gosiRate = '';
    let gosi = null;
    let gosiErr = '';
    let qiwa = null;
    let qiwaErr = '';

    host.innerHTML = '<p class="erp-text-sm erp-text-muted" data-cmp-note>جارٍ التحميل…</p><div data-cmp-root></div>';
    const root = host.querySelector('[data-cmp-root]');
    const note = host.querySelector('[data-cmp-note]');

    const say = (m) => { if (note) {note.textContent = m || '';} if (m) {notify(m);} };

    function providerCard(p) {
        const card = document.createElement('article');
        card.className = 'erp-card';

        const tone = TONE[p.verification] || 'neutral';
        const label = LABEL[p.verification] || p.verification;
        const head = document.createElement('div');
        head.className = 'erp-card__head';

        const title = document.createElement('h3');
        title.className = 'erp-card__title';
        title.append(document.createTextNode(String(p.name_ar ?? '')));
        const englishName = document.createElement('span');
        englishName.className = 'erp-eyebrow';
        englishName.dir = 'ltr';
        englishName.lang = 'en';
        englishName.textContent = String(p.name_en ?? '');
        title.append(englishName);

        const badge = document.createElement('span');
        badge.className = 'erp-badge';
        badge.dataset.tone = tone;
        badge.textContent = String(label ?? '');
        head.append(title, badge);

        const body = document.createElement('div');
        body.className = 'erp-card__body erp-stack';
        const evidence = document.createElement('p');
        evidence.className = 'erp-text-sm erp-text-muted';
        evidence.textContent = String(p.evidence_note || 'لا يوجد دليل مسجّل.')
            + (p.code === 'zatca' && data?.zatca
                ? ` · البيئة: ${String(data.zatca.environment || '—')} · في الطابور: ${Number(data.zatca.queued) || 0}`
                : '');
        const verified = document.createElement('p');
        verified.className = 'erp-text-sm erp-text-muted';
        verified.textContent = `آخر تحقق: ${fmtDate(p.last_verified_at)}`;
        body.append(evidence, verified);

        if (p.verification === 'VERIFIED') {
            const toggle = document.createElement('label');
            toggle.className = 'erp-field';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.cmpToggle = String(p.code ?? '');
            input.checked = Boolean(p.is_enabled);
            input.disabled = !canSettings;
            const labelText = document.createElement('span');
            labelText.textContent = 'مفعّل';
            toggle.append(input, labelText);
            body.append(toggle);
        } else {
            const hint = document.createElement('span');
            hint.className = 'erp-text-sm erp-text-muted';
            hint.textContent = 'التفعيل يتطلب تحققًا موثّقًا.';
            body.append(hint);
        }

        card.append(head, body);
        return card;
    }

    function outboxTable() {
        if (!dead.length) {
            return '<p class="erp-text-sm erp-text-muted">لا توجد صفوف ميتة.</p>';
        }
        const rows = dead.map((r) => {
            const actions = [
                canSubmit ? `<button type="button" class="erp-btn erp-btn--sm" data-cmp-retry="${Number(r.id)}">إعادة</button>` : '',
                canReview ? `<button type="button" class="erp-btn erp-btn--sm" data-cmp-review="retry" data-id="${Number(r.id)}">اعتماد إعادة</button>` : '',
                canReview ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-cmp-review="abandon" data-id="${Number(r.id)}">إلغاء</button>` : '',
            ].join(' ');
            return `<tr>
                <td class="erp-td">${esc(fmtDate(r.created_at))}</td>
                <td class="erp-td" dir="ltr">${esc(r.event_type)}</td>
                <td class="erp-td erp-num" dir="ltr">${Number(r.attempts) || 0}/${Number(r.max_attempts) || 0}</td>
                <td class="erp-td" dir="ltr">${esc(r.last_error_code || '—')}</td>
                <td class="erp-td">${actions || '—'}</td>
            </tr>`;
        }).join('');
        return `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
            <thead><tr><th>الوقت</th><th>الحدث</th><th>المحاولات</th><th>الخطأ</th><th>إجراء</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    function eventsList() {
        if (!events.length) {return '<p class="erp-text-sm erp-text-muted">لا توجد أحداث.</p>';}
        const rows = events.slice(0, 8).map((e) => `<tr>
            <td class="erp-td">${esc(fmtDate(e.occurred_at))}</td>
            <td class="erp-td" dir="ltr">${esc(e.provider_code)}</td>
            <td class="erp-td" dir="ltr">${esc(e.direction)}</td>
            <td class="erp-td" dir="ltr">${esc(e.error_code || e.outcome)}</td>
        </tr>`).join('');
        return `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
            <thead><tr><th>الوقت</th><th>المزوّد</th><th>الاتجاه</th><th>النتيجة</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    function paint() {
        const providers = Array.isArray(data?.providers) ? data.providers : [];
        const unverified = providers.filter((p) => p.verification !== 'VERIFIED');
        const banner = unverified.length
            ? `<p><span class="erp-badge" data-tone="warning">لا يوجد اعتماد حكومي إنتاجي موثّق بعد — الحالة المعروضة حالة نظام، وليست قبولًا من الجهة.</span></p>`
            : '';
        const counts = data?.outbox;
        const outboxBlock = counts
            ? `<p>
                    <span class="erp-badge" data-tone="neutral">معلّق: ${Number(counts.pending) || 0}</span>
                    <span class="erp-badge" data-tone="warning">فاشل: ${Number(counts.failed) || 0}</span>
                    <span class="erp-badge" data-tone="danger">ميت: ${Number(counts.dead_letter) || 0}</span>
                    <span class="erp-badge" data-tone="neutral">أقدم انتظار: ${ageText(counts.oldest_pending_age_seconds)}</span>
                </p>`
            : '<p><span class="erp-badge" data-tone="neutral">صندوق الصادر غير مثبَّت بعد — هجرة 145 غير مطبقة على هذه القاعدة.</span></p>';
        root.innerHTML = `<div class="erp-stack">
            ${banner}
            <div class="erp-cards" data-cmp-providers></div>
            ${wpsSection()}
            ${gosiSection()}
            ${qiwaSection()}
            <section class="erp-card">
                <div class="erp-card__head">
                    <h3 class="erp-card__title">التسليم</h3>
                    <button type="button" class="erp-btn erp-btn--sm" data-cmp-refresh>تحديث</button>
                </div>
                <div class="erp-card__body erp-stack">
                    ${outboxBlock}
                    ${outboxTable()}
                </div>
            </section>
            <section class="erp-card">
                <div class="erp-card__head"><h3 class="erp-card__title">آخر الأحداث</h3></div>
                <div class="erp-card__body">${eventsList()}</div>
            </section>
        </div>`;
        const providerGrid = root.querySelector('[data-cmp-providers]');
        for (const provider of providers) {
            providerGrid.append(providerCard(provider));
        }
    }

    function wpsSection() {
        const reqs = Array.isArray(wpsReq?.requirements) ? wpsReq.requirements : [];
        const reqRows = reqs.map((r) => `<tr>
            <td class="erp-td">${esc(r.title_ar)}${r.detail ? ` — ${esc(r.detail)}` : ''}</td>
            <td class="erp-td">${statusBadge(r.status)}</td>
        </tr>`).join('');
        const blockers = Array.isArray(wps?.blockers) ? wps.blockers : [];
        const blockerHtml = blockers.length
            ? `<p class="erp-text-sm">${blockers.map((b) => `<span class="erp-badge" data-tone="danger">${esc(BLOCK_LABEL[b] || b)}</span>`).join(' ')}</p>`
            : '<p class="erp-text-sm erp-text-muted">لا موانع مسجّلة لهذا الشهر.</p>';
        const summary = wps?.summary
            ? `<p>
                    <span class="erp-badge" data-tone="${wps.export_ready ? 'success' : 'warning'}">جاهز للكشف: ${Number(wps.summary.ready) || 0}/${Number(wps.summary.employees) || 0}</span>
                    <span class="erp-badge" data-tone="neutral">بلا IBAN: ${Number(wps.summary.missing_iban) || 0}</span>
                    <span class="erp-badge" data-tone="neutral">بلا هوية: ${Number(wps.summary.missing_id) || 0}</span>
                    <span class="erp-badge" data-tone="neutral">بلا راتب: ${Number(wps.summary.missing_salary) || 0}</span>
                    <span class="erp-badge" data-tone="neutral">جنسية مجهولة: ${Number(wps.summary.unknown_nationality) || 0}</span>
                </p>`
            : '';
        const issues = Array.isArray(wps?.employees) ? wps.employees.filter((e) => !e.ready).slice(0, 8) : [];
        const issueRows = issues.map((e) => {
            const editor = canSettings
                ? `<div class="erp-stack">
                        <input class="erp-input" dir="ltr" maxlength="34" placeholder="SA…" data-bank-iban="${Number(e.employee_id)}">
                        <input class="erp-input" dir="ltr" maxlength="2" placeholder="SA/EG…" data-bank-nat="${Number(e.employee_id)}">
                        <input class="erp-input" dir="ltr" maxlength="12" placeholder="رقم التأمينات" data-bank-gosi="${Number(e.employee_id)}">
                        <button type="button" class="erp-btn erp-btn--sm" data-bank-save="${Number(e.employee_id)}">حفظ</button>
                    </div>`
                : '—';
            const issuesText = (e.issues || []).map((code) => ISSUE_LABEL[code] || code).join(' · ');
            return `<tr>
                <td class="erp-td">${esc(e.name)}</td>
                <td class="erp-td erp-mono" dir="ltr">${esc(e.iban_masked || '—')}</td>
                <td class="erp-td erp-text-sm">${esc(issuesText)}</td>
                <td class="erp-td">${editor}</td>
            </tr>`;
        }).join('');
        const table = issueRows
            ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
                    <thead><tr><th>الموظف</th><th>IBAN</th><th>النواقص</th><th>استكمال (مدير/إعداد)</th></tr></thead>
                    <tbody>${issueRows}</tbody></table></div>`
            : '';
        return `<section class="erp-card">
            <div class="erp-card__head">
                <h3 class="erp-card__title">حماية الأجور (مدد) ${statusBadge('BLOCKED')}</h3>
                <label class="erp-field"><span>الشهر</span>
                    <input class="erp-input" type="month" value="${esc(month)}" data-wps-month></label>
                <button type="button" class="erp-btn erp-btn--sm" data-wps-refresh>تحقق</button>
            </div>
            <div class="erp-card__body erp-stack">
                <p class="erp-text-sm erp-text-muted">${esc(wpsReq?.note || 'فحص جاهزية محلي فقط — لا ربط API مع مدد ولا رفع تلقائي (ADR-008).')}</p>
                ${wpsErr ? `<p class="erp-text-sm"><span class="erp-badge" data-tone="danger">${esc(wpsErr)}</span></p>` : ''}
                ${reqRows ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
                    <thead><tr><th>المتطلب</th><th>الحالة</th></tr></thead><tbody>${reqRows}</tbody></table></div>` : ''}
                ${summary}
                ${blockerHtml}
                ${canSubmit ? `<p><button type="button" class="erp-btn erp-btn--sm" data-wps-export ${wps?.export_ready ? '' : 'disabled'}>توليد كشف المراجعة</button></p>` : ''}
                ${table}
            </div>
        </section>`;
    }

    function gosiSection() {
        const options = Array.isArray(rates) ? rates.map((r) => `<option value="${esc(r.id)}" ${r.id === gosiRate ? 'selected' : ''}>${esc(r.label_ar)}</option>`).join('') : '';
        const lines = Array.isArray(gosi?.lines) ? gosi.lines.slice(0, 12).map((l) => `<tr>
                <td class="erp-td">${esc(l.name)}</td>
                <td class="erp-td" dir="ltr">${esc(l.category)}</td>
                <td class="erp-td erp-num" dir="ltr">${Number(l.wage).toFixed(2)}</td>
                <td class="erp-td erp-num" dir="ltr">${Number(l.employee).toFixed(2)}</td>
                <td class="erp-td erp-num" dir="ltr">${Number(l.employer).toFixed(2)}</td>
            </tr>`).join('') : '';
        const table = lines ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
                <thead><tr><th>الموظف</th><th>التصنيف</th><th>الأجر</th><th>حصة الموظف</th><th>حصة صاحب العمل</th></tr></thead>
                <tbody>${lines}</tbody></table></div>` : '';
        const totals = gosi?.totals
            ? `<p>
                    <span class="erp-badge" data-tone="neutral">حصة الموظفين: ${Number(gosi.totals.employee).toFixed(2)}</span>
                    <span class="erp-badge" data-tone="neutral">حصة المنشأة: ${Number(gosi.totals.employer).toFixed(2)}</span>
                    <span class="erp-badge" data-tone="${gosi.estimate ? 'warning' : 'neutral'}">${gosi.estimate ? 'تقديري من الراتب الأساسي' : 'من المسير'}</span>
                </p>`
            : '';
        return `<section class="erp-card">
            <div class="erp-card__head"><h3 class="erp-card__title">التأمينات (GOSI) — عرض فقط</h3></div>
            <div class="erp-card__body erp-stack">
                <p class="erp-text-sm erp-text-muted">النسب غير موثّقة داخل النظام — اختر المجموعة صراحة، واعتمادها مسؤولية المحاسب. لا يُكتب أي قيد.</p>
                <p>
                    <label class="erp-field"><span>مجموعة النسب</span>
                        <select class="erp-input" data-gosi-rate>${options || '<option value="">غير متاح</option>'}</select></label>
                    <button type="button" class="erp-btn erp-btn--sm" data-gosi-run ${options ? '' : 'disabled'}>عرض</button>
                </p>
                ${gosiErr ? `<p class="erp-text-sm"><span class="erp-badge" data-tone="danger">${esc(gosiErr)}</span></p>` : ''}
                ${gosi?.estimate ? '<p><span class="erp-badge" data-tone="warning">تقديري — لا يوجد مسير مُقفل لهذا الشهر</span></p>' : ''}
                ${table}
                ${totals}
            </div>
        </section>`;
    }

    function qiwaSection() {
        const checks = Array.isArray(qiwa?.checks) ? qiwa.checks : [];
        const rows = checks.map((c) => `<tr>
            <td class="erp-td">${esc(c.label_ar)}</td>
            <td class="erp-td">${esc(c.detail)}</td>
            <td class="erp-td"><span class="erp-badge" data-tone="${c.ok ? 'success' : 'warning'}">${c.ok ? 'متاح' : 'ناقص'}</span></td>
        </tr>`).join('');
        return `<section class="erp-card">
            <div class="erp-card__head"><h3 class="erp-card__title">قوى — جاهزية البيانات ${statusBadge('UNVERIFIED')}</h3></div>
            <div class="erp-card__body erp-stack">
                <p class="erp-text-sm erp-text-muted">${esc(qiwa?.note || 'فحص محلي فقط — لا ربط API مع قوى.')}</p>
                ${qiwaErr ? `<p class="erp-text-sm"><span class="erp-badge" data-tone="danger">${esc(qiwaErr)}</span></p>` : ''}
                ${rows ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
                    <thead><tr><th>الفحص</th><th>التفصيل</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
            </div>
        </section>`;
    }

    async function loadWps() {
        wpsErr = '';
        try {
            const [req, ready] = await Promise.all([
                fetchWpsRequirements(month),
                fetchWpsReadiness(month),
            ]);
            wpsReq = req;
            wps = ready;
        } catch (e) {
            wpsErr = (e && e.message) || 'تعذر تحميل جاهزية مدد.';
        }
    }

    async function loadGosiMeta() {
        try {
            const res = await fetchGosiRates();
            rates = Array.isArray(res?.rates) ? res.rates : null;
            if (rates && rates.length && !rates.some((r) => r.id === gosiRate)) {gosiRate = rates[0].id;}
        } catch {
            rates = null;
        }
    }

    async function loadQiwa() {
        qiwaErr = '';
        try {
            qiwa = await fetchQiwaReadiness();
        } catch (e) {
            qiwaErr = (e && e.message) || 'تعذر تحميل جاهزية قوى.';
        }
    }

    async function runGosi() {
        if (!gosiRate || !MONTH_RE.test(month)) {return;}
        gosiErr = '';
        try {
            gosi = await fetchGosiPreview(month, gosiRate);
        } catch (e) {
            gosiErr = (e && e.message) || 'تعذر حساب عرض التأمينات.';
        }
        if (host.isConnected) {paint();}
    }

    function downloadCsv(name, text) {
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    async function exportSheet() {
        try {
            const res = await generateWpsSheet(month);
            downloadCsv(res.filename || `wps-review-${month}.csv`, res.csv);
            say(`كشف المراجعة أُنشئ — البصمة ${String(res.sha256).slice(0, 12)}…`);
            await auditNote();
        } catch (e) {
            const list = e && e.details && Array.isArray(e.details.blockers) ? e.details.blockers : [];
            const extra = list.length ? `: ${list.map((b) => BLOCK_LABEL[b] || b).join(' · ')}` : '';
            say(((e && e.message) || 'تعذر توليد الكشف.') + extra);
        }
    }

    async function auditNote() {
        await loadWps();
        if (host.isConnected) {paint();}
    }

    async function saveBank(id) {
        const row = host.querySelector(`[data-bank-save="${id}"]`)?.closest('tr');
        const patch = {};
        const iban = row?.querySelector(`[data-bank-iban="${id}"]`)?.value.trim();
        const nat = row?.querySelector(`[data-bank-nat="${id}"]`)?.value.trim();
        const gosiNumber = row?.querySelector(`[data-bank-gosi="${id}"]`)?.value.trim();
        if (iban) {patch.iban = iban;}
        if (nat) {patch.nationality = nat;}
        if (gosiNumber) {patch.gosiNumber = gosiNumber;}
        if (!Object.keys(patch).length) {say('أدخل IBAN أو الجنسية أو رقم التأمينات أولًا.'); return;}
        try {
            await saveEmployeeBank(id, patch);
            say('حُفظت بيانات الموظف.');
            await auditNote();
        } catch (e) {
            say((e && e.message) || 'تعذر حفظ بيانات الموظف.');
        }
    }

    async function load() {
        if (busy) {return;}
        busy = true;
        say('جارٍ التحميل…');
        try {
            const [health, deadRes, eventsRes] = await Promise.all([
                fetchComplianceHealth(),
                fetchComplianceOutbox('dead_letter').catch(() => ({ rows: [] })),
                fetchComplianceEvents(20).catch(() => ({ rows: [] })),
            ]);
            data = health;
            dead = Array.isArray(deadRes?.rows) ? deadRes.rows : [];
            events = Array.isArray(eventsRes?.rows) ? eventsRes.rows : [];
            await Promise.all([loadWps(), loadGosiMeta(), loadQiwa()]);
            if (!host.isConnected) {return;}
            note.textContent = '';
            paint();
        } catch (e) {
            if (!host.isConnected) {return;}
            const unavailable = e && (e.status === 404 || e.status === 503);
            note.textContent = unavailable
                ? 'خدمة الامتثال غير مفعّلة على الخادم بعد.'
                : ((e && e.message) || 'تعذر تحميل حالة الامتثال.');
        } finally {
            busy = false;
        }
    }

    async function act(task) {
        try {
            await task();
            await load();
        } catch (e) {
            say((e && e.message) || 'تعذر تنفيذ الإجراء.');
        }
    }

    function runRetry(id) {
        return act(() => retryComplianceRow(id));
    }

    function runReview(id, decision) {
        const question = decision === 'abandon'
            ? 'إلغاء هذه المحاولة نهائيًا؟ لن تُرسل مرة أخرى.'
            : 'اعتماد إعادة إرسال هذه المحاولة؟';
        return Promise.resolve(confirmFn(question)).then((ok) => {
            if (!ok) {return;}
            return act(() => reviewComplianceRow(id, decision, 'مراجعة يدوية من شاشة الامتثال'));
        });
    }

    const onClick = (event) => {
        const retry = event.target.closest('[data-cmp-retry]');
        if (retry) {runRetry(Number(retry.dataset.cmpRetry)); return;}
        const review = event.target.closest('[data-cmp-review]');
        if (review) {runReview(Number(review.dataset.id), review.dataset.cmpReview); return;}
        if (event.target.closest('[data-cmp-refresh]')) {load(); return;}
        if (event.target.closest('[data-wps-refresh]')) {
            auditNote().catch((e) => say((e && e.message) || 'تعذر تحديث جاهزية مدد.'));
            return;
        }
        const exp = event.target.closest('[data-wps-export]');
        if (exp) {
            if (exp.disabled) {return;}
            Promise.resolve(confirmFn(`توليد كشف أجور ${month} للمراجعة؟ لن يُرفع إلى مدد.`))
                .then((ok) => (ok ? exportSheet() : null))
                .catch((e) => say((e && e.message) || 'تعذر توليد الكشف.'));
            return;
        }
        const bank = event.target.closest('[data-bank-save]');
        if (bank) {
            saveBank(Number(bank.dataset.bankSave));
            return;
        }
        if (event.target.closest('[data-gosi-run]')) {
            runGosi().catch((e) => say((e && e.message) || 'تعذر حساب العرض.'));
        }
    };

    const onChange = (event) => {
        const monthInput = event.target.closest('[data-wps-month]');
        if (monthInput) {
            const value = String(monthInput.value || '');
            if (!MONTH_RE.test(value)) {return;}
            month = value;
            gosi = null;
            gosiErr = '';
            auditNote().catch(() => {});
            return;
        }
        const rateSelect = event.target.closest('[data-gosi-rate]');
        if (rateSelect) {
            gosiRate = String(rateSelect.value || '');
            return;
        }
        const toggle = event.target.closest('[data-cmp-toggle]');
        if (!toggle) {return;}
        const code = toggle.dataset.cmpToggle;
        const enabled = Boolean(toggle.checked);
        const provider = (data?.providers || []).find((p) => p.code === code);
        const question = enabled
            ? `تفعيل ${provider ? provider.name_ar : code}؟`
            : `تعطيل ${provider ? provider.name_ar : code}؟`;
        Promise.resolve(confirmFn(question)).then((ok) => {
            if (!ok) {toggle.checked = !enabled; return;}
            return act(() => setComplianceProviderEnabled(code, enabled));
        }).catch((e) => say((e && e.message) || 'تعذر تغيير حالة المزوّد.'));
    };

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);

    return {
        load,
        destroy() {
            root.removeEventListener('click', onClick);
            root.removeEventListener('change', onChange);
            host.innerHTML = '';
        },
    };
}
