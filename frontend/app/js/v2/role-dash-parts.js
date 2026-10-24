/**
 * V2 — Shared markup for the three live role dashboards (P2-7)
 * ═══════════════════════════════════════════════════════════════════════
 * Presentation only: escaping, money formatting, KPI strip, compact list and
 * the named-source failure line. No data, no network, no listeners — the
 * screens own fetching and behaviour, exactly like every other V2 screen.
 */

import { formatMoney, formatInt } from './data/reports-repo.js?v=4.9.152';

export const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Money as text — for chart titles and the `title` attribute. */
export function moneyText(v, currency) {
    const m = formatMoney(v, currency);
    return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
}

/** Money as markup — number isolated LTR, unit muted when the setting has one. */
export function money(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

export const int = (v) => formatInt(v);

/**
 * KPI strip — the same ul.erp-kpis structure the briefing and HR screens use.
 * `value` is text unless `valueHtml` is supplied; only the caller knows which
 * number deserves an LTR-isolated span.
 */
export function kpiStrip(kpis) {
    return `<ul class="erp-kpis">`
        + kpis.map((k, i) => `
      <li class="erp-kpi" style="--erp-rise-i:${i}">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon || 'chart')}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}${k.en ? `<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span>` : ''}</span>
        </div>
        <div class="erp-kpi__value">${k.valueHtml || `<span class="erp-num" dir="ltr">${esc(k.value ?? '—')}</span>`}${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        ${k.hint ? `<div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>` : ''}
      </li>`).join('')
        + `</ul>`;
}

/** Compact latest-rows list; amounts arrive as trusted markup from money(). */
export function miniList(items, emptyText, emptyHint = '') {
    if (!items.length) {
        return `<div class="erp-state">
          <span class="erp-state__title">${esc(emptyText)}</span>
          ${emptyHint ? `<span>${esc(emptyHint)}</span>` : ''}
        </div>`;
    }
    return `<ul class="erp-minis">${items.map((it) => `
      <li class="erp-mini">
        <span class="erp-mini__main">${esc(it.main)}${it.sub ? `<span class="erp-mini__sub">${esc(it.sub)}</span>` : ''}</span>
        <span class="erp-mini__amount">${it.amountHtml || ''}</span>
      </li>`).join('')}</ul>`;
}

/** The screen says which sources did not answer; silence would look complete. */
export function failureBox(failures) {
    const list = (Array.isArray(failures) ? failures : []).filter(Boolean);
    if (!list.length) {return '';}
    return `<div class="erp-error" role="alert">مصادر لم تستجب: ${esc(list.join(' · '))} — كل رقم معروض جاء من مصدر أجاب.</div>`;
}
