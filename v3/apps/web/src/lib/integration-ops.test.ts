import { describe, expect, it } from 'vitest';
import {
    ageText,
    eventDirectionLabel,
    eventOutcomeLabel,
    integrationHealthSchema,
    outboxRetryable,
    outboxReviewable,
    outboxRowSchema,
    outboxStatusLabel,
    providerToggleAllowed,
    providerVerification,
} from './integration-ops';

/**
 * عقود تشغيل التكامل — مطابقة `backend/integration/routes.js:125-418`
 * وتسميات V2 `compliance.js:14-90`. لا تُختبر الشبكة هنا، الشكل فقط.
 */

describe('integrationHealthSchema', () => {
    it('يقبل الحالة الكاملة ويحوّل العدّادات', () => {
        const health = integrationHealthSchema.parse({
            providers: [
                {
                    code: 'zatca',
                    name_ar: 'هيئة الزكاة',
                    name_en: 'ZATCA',
                    verification: 'VERIFIED',
                    is_enabled: true,
                    evidence_note: 'دليل',
                    last_verified_at: '2026-11-01T00:00:00Z',
                },
            ],
            outbox: {
                by_status: { pending: 2 },
                pending: '2',
                failed: '1',
                dead_letter: 0,
                oldest_pending_age_seconds: 90,
            },
            infra: { migration_145: true },
            generated_at: '2026-11-11T10:00:00Z',
        });
        expect(health.providers).toHaveLength(1);
        expect(health.providers[0]?.is_enabled).toBe(true);
        expect(health.outbox?.pending).toBe(2);
        expect(health.outbox?.failed).toBe(1);
        expect(health.outbox?.oldest_pending_age_seconds).toBe(90);
        expect(health.infra?.migration_145).toBe(true);
    });

    it('يعطي مزوّدين فارغين وصندوقًا null عندما لا تكون هجرة 145 مطبقة', () => {
        const health = integrationHealthSchema.parse({ outbox: null, infra: { migration_145: false } });
        expect(health.providers).toEqual([]);
        expect(health.outbox).toBeNull();
        expect(health.infra?.migration_145).toBe(false);
    });
});

describe('outboxRowSchema', () => {
    it('يقرأ صف الصادر بلا الحمولة', () => {
        const row = outboxRowSchema.parse({
            id: 17,
            provider_code: 'zatca',
            event_type: 'invoice.clearance',
            status: 'dead_letter',
            attempts: 5,
            max_attempts: 5,
            last_error_code: 'HTTP_500',
            created_at: '2026-11-10T00:00:00Z',
            payload_sha256: 'abc',
        });
        expect(row.id).toBe('17');
        expect(row.attempts).toBe(5);
        expect(row.status).toBe('dead_letter');
    });
});

describe('تسميات ودلالات V2', () => {
    it('يرسم تصنيف المزوّد كما في compliance.js', () => {
        expect(providerVerification('VERIFIED')).toEqual({ label: 'موثّق', tone: 'success' });
        expect(providerVerification('INFERRED')).toEqual({ label: 'مستنتج', tone: 'warning' });
        expect(providerVerification('UNVERIFIED')).toEqual({ label: 'غير موثّق', tone: 'neutral' });
        expect(providerVerification('BLOCKED')).toEqual({ label: 'محظور', tone: 'danger' });
        expect(providerVerification('CUSTOM')).toEqual({ label: 'CUSTOM', tone: 'neutral' });
    });

    it('يسمّي حالات الصادر وشرطَي المحاولة والمراجعة', () => {
        expect(outboxStatusLabel('dead_letter')).toBe('ميت');
        expect(outboxStatusLabel('delivered')).toBe('مُسلَّم');
        expect(outboxStatusLabel(null)).toBe('—');
        expect(outboxRetryable('failed')).toBe(true);
        expect(outboxRetryable('dead_letter')).toBe(true);
        expect(outboxRetryable('pending')).toBe(false);
        expect(outboxReviewable('dead_letter')).toBe(true);
        expect(outboxReviewable('failed')).toBe(false);
    });

    it('يمنع تفعيل غير الموثّق ويصوغ عمر الانتظار', () => {
        const base = { code: 'x', verification: 'VERIFIED' };
        expect(providerToggleAllowed(base)).toBe(true);
        expect(providerToggleAllowed({ code: 'x', verification: 'BLOCKED' })).toBe(false);
        expect(ageText(45)).toBe('45 ث');
        expect(ageText(90)).toBe('1 د');
        expect(ageText(7200)).toBe('2 س');
        expect(eventDirectionLabel('internal')).toBe('داخلي');
        expect(eventOutcomeLabel('success')).toBe('نجاح');
    });
});
