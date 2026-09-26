/**
 * audit-engine/engine.js — نواة محرك الفحص الشامل (Audit & Remediation Engine)
 * ────────────────────────────────────────────────────────────────────────────
 * العقد:
 *   Check   = { id, domain, title, description, severity, weight?, fixRisk?, detect(ctx), remediate?(ctx), fixHint? }
 *   Finding = نتيجة فحص واحدة (status/severity/detail/evidence/remediation/fixed...)
 *
 * مبادئ:
 *   - كل فحص معزول + مهلة زمنية: فحص واحد متعثّر لا يُسقط الفحص كله.
 *   - الإصلاح opt-in (--fix) ولا يمس أي شيء إلا عبر remediate() مع dry-run.
 *   - النتيجة (0-100) مرجّحة بخطورة كل مشكلة.
 */
'use strict';

const SEVERITY = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
const SEVERITY_PENALTY = { CRITICAL: 25, HIGH: 12, MEDIUM: 5, LOW: 2, INFO: 0 };
const STATUS = {
    PASS: 'pass', INFO: 'info', WARN: 'warn', FAIL: 'fail',
    ERROR: 'error', FIXED: 'fixed', SKIPPED: 'skipped',
};

function grade(score) {
    if (score >= 90) {return 'A';}
    if (score >= 80) {return 'B';}
    if (score >= 70) {return 'C';}
    if (score >= 60) {return 'D';}
    return 'F';
}

function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
        t = setTimeout(() => reject(Object.assign(new Error(`timeout after ${ms}ms`), { code: 'AUDIT_TIMEOUT', label })), ms);
        if (t.unref) {t.unref();}
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function baseFinding(check) {
    return {
        id: check.id,
        domain: check.domain,
        title: check.title,
        description: check.description || '',
        severity: check.severity || 'INFO',
        weight: Number(check.weight) || 1,
        fixRisk: check.fixRisk || 'safe',
    };
}

/** تشغيل فحص واحد: كشف → (إصلاح اختياري) → إعادة كشف للتأكيد */
async function runCheck(check, ctx, opts = {}) {
    const { fix = false, dryRun = false, timeoutMs = 8000 } = opts;
    const started = Date.now();
    const finding = baseFinding(check);

    let detected;
    try {
        detected = await withTimeout(Promise.resolve().then(() => check.detect(ctx)), timeoutMs, check.id);
    } catch (e) {
        Object.assign(finding, {
            status: STATUS.ERROR,
            detail: `تعذّر إتمام الفحص: ${String(e && e.message || e).slice(0, 200)}`,
            durationMs: Date.now() - started,
        });
        return finding;
    }

    detected = detected || {};
    finding.status = detected.status || STATUS.PASS;
    if (detected.severity) {finding.severity = detected.severity;}
    finding.detail = detected.detail || '';
    finding.evidence = detected.evidence;
    finding.remediation = detected.remediation || check.fixHint || '';

    const needsFix = finding.status === STATUS.FAIL || finding.status === STATUS.WARN;
    if (needsFix && fix && typeof check.remediate === 'function' && finding.fixRisk !== 'review') {
        if (dryRun) {
            finding.dryRunFix = true;
            finding.fixMessage = `[dry-run] سيُطبَّق إصلاح: ${finding.remediation || check.id}`;
        } else {
            try {
                const r = await withTimeout(Promise.resolve().then(() => check.remediate(ctx)), timeoutMs * 3, `${check.id}:fix`);
                const after = await withTimeout(Promise.resolve().then(() => check.detect(ctx)), timeoutMs, `${check.id}:recheck`);
                const okAfter = after && (after.status === STATUS.PASS || after.status === STATUS.INFO);
                finding.fixed = Boolean(r && r.ok) && okAfter;
                finding.fixMessage = (r && r.message) || (finding.fixed ? 'تم الإصلاح' : 'لم يكتمل الإصلاح');
                if (finding.fixed) {
                    finding.status = STATUS.FIXED;
                    finding.severity = (after && after.severity) || finding.severity;
                    finding.detail = (after && after.detail) || finding.detail;
                } else if (after && after.status) {
                    finding.status = after.status;
                    finding.detail = (after && after.detail) || finding.detail;
                }
            } catch (e) {
                finding.fixed = false;
                finding.fixMessage = `فشل الإصلاح: ${String(e && e.message || e).slice(0, 200)}`;
            }
        }
    } else if (needsFix && finding.fixRisk === 'review') {
        finding.fixMessage = `يتطلب مراجعة يدوية: ${finding.remediation || ''}`.trim();
    }

    finding.durationMs = Date.now() - started;
    return finding;
}

/** حساب النتيجة والتقدير والعدّادات من قائمة النتائج */
function summarize(findings) {
    const counts = { pass: 0, info: 0, warn: 0, fail: 0, error: 0, fixed: 0, skipped: 0, total: findings.length };
    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    let penalty = 0;

    for (const f of findings) {
        counts[f.status] = (counts[f.status] || 0) + 1;
        const w = f.weight || 1;
        if (f.status === STATUS.FAIL) {
            penalty += (SEVERITY_PENALTY[f.severity] || 0) * w;
            bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
        } else if (f.status === STATUS.WARN) {
            penalty += Math.ceil((SEVERITY_PENALTY[f.severity] || 0) * 0.4) * w;
        } else if (f.status === STATUS.ERROR) {
            penalty += 3 * w;
        }
        // FIXED / PASS / INFO / SKIPPED → لا خصم
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    return { score, grade: grade(score), counts, bySeverity };
}

/**
 * تشغيل الفحص الشامل.
 * @param {object} p
 * @param {Array}  p.checks    قائمة الفحوصات
 * @param {object} p.ctx       سياق الفحص (pool/env/paths/http/logger)
 * @param {boolean}[p.fix]     تطبيق الإصلاحات الآمنة
 * @param {boolean}[p.dryRun]  محاكاة الإصلاح بلا تنفيذ
 * @param {string[]}[p.domains] حصر على نطاقات معيّنة
 * @param {number} [p.timeoutMs]
 * @param {Function}[p.onProgress] يُستدعى بعد كل فحص
 */
async function runAudit({ checks, ctx, fix = false, dryRun = false, domains = null, timeoutMs = 8000, onProgress = null }) {
    const selected = Array.isArray(checks)
        ? checks.filter((c) => c && typeof c.detect === 'function' && (!domains || domains.includes(c.domain)))
        : [];

    const findings = [];
    for (const check of selected) {
        const f = await runCheck(check, ctx, { fix, dryRun, timeoutMs });
        findings.push(f);
        if (typeof onProgress === 'function') {
            try { onProgress(f); } catch (_) {}
        }
    }

    const { score, grade: g, counts, bySeverity } = summarize(findings);
    return {
        ok: counts.fail === 0 && bySeverity.CRITICAL === 0 && counts.error === 0,
        score,
        grade: g,
        counts,
        bySeverity,
        fix,
        dryRun,
        generatedAt: new Date().toISOString(),
        findings,
    };
}

module.exports = {
    SEVERITY, SEVERITY_PENALTY, STATUS,
    grade, withTimeout, runCheck, runAudit, summarize,
};
