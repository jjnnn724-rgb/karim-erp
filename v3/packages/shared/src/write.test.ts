import { describe, expect, test } from 'vitest';
import { IDEMPOTENCY_KEY_PATTERN, resolveJournalSourceId } from './write.js';

/**
 * مفتاح idempotency — العقد الوحيد الذي يُحل في طبقة v3 قبل القديم:
 *  · غياب المفتاح ⇒ `source_id` كما هو، فيبقى سلوك القديم حرفيًا.
 *  · وجوده ⇒ `idem:<key>`، فيصير `uq_journal_source` هو الحارس.
 *  · تعارضه مع `source_id` صريح ⇒ 422، لا تغليب صامت لأحدهما.
 */

describe('resolveJournalSourceId', () => {
    test('بلا مفتاح: يمرّر source_id الخام أو null', () => {
        expect(resolveJournalSourceId({})).toEqual({ ok: true, source_id: null, keyed: false });
        expect(resolveJournalSourceId({ source_id: '  PO-12  ' })).toEqual({
            ok: true,
            source_id: 'PO-12',
            keyed: false,
        });
        expect(resolveJournalSourceId({ source_id: '   ' })).toEqual({ ok: true, source_id: null, keyed: false });
        expect(resolveJournalSourceId({ source_id: 42 })).toEqual({ ok: true, source_id: '42', keyed: false });
    });

    test('مفتاح صالح: source_id = idem:<key>', () => {
        expect(resolveJournalSourceId({ idempotency_key: 'cashier-close-2026-11-07' })).toEqual({
            ok: true,
            source_id: 'idem:cashier-close-2026-11-07',
            keyed: true,
        });
    });

    test('مفتاح فارغ كترويسة غائبة', () => {
        expect(resolveJournalSourceId({ idempotency_key: '  ' })).toEqual({ ok: true, source_id: null, keyed: false });
    });

    test('source_id صريح يطابق المشتق ⇒ مقبول', () => {
        expect(resolveJournalSourceId({ source_id: 'idem:retry-1', idempotency_key: 'retry-1' })).toEqual({
            ok: true,
            source_id: 'idem:retry-1',
            keyed: true,
        });
    });

    test('source_id صريح يخالف المفتاح ⇒ 422 CONFLICT', () => {
        const out = resolveJournalSourceId({ source_id: 'PO-12', idempotency_key: 'retry-1' });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.status).toBe(422);
            expect(out.error).toBe('IDEMPOTENCY_KEY_CONFLICT');
        }
    });

    test.each(['has space', 're/peat', 'سجل', 'a'.repeat(201), 'x\ny'])('مفتاح غير صالح «%s» ⇒ 422', (key) => {
        const out = resolveJournalSourceId({ idempotency_key: key });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.status).toBe(422);
            expect(out.error).toBe('IDEMPOTENCY_KEY_INVALID');
        }
    });

    test('النمط يقبل 200 محرفًا بالضبط ويرفض 201', () => {
        expect(IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(200))).toBe(true);
        expect(IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(201))).toBe(false);
    });
});
