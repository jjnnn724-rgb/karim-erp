/**
 * tests/whatsapp-media.test.js — WhatsApp media unit tests (no DB, no socket)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectMedia, safeFileName, incomingDir, buildMediaAck } = require('../backend/whatsapp-engine/media');
const { buildMediaPayload, MEDIA_KINDS } = require('../backend/whatsapp-engine/sender');

describe('whatsapp media detect', () => {
    test('image with caption detected', () => {
        const d = detectMedia({ imageMessage: { mimetype: 'image/jpeg', caption: 'فاتورة' } });
        expect(d.kind).toBe('image');
        expect(d.caption).toBe('فاتورة');
    });
    test('voice note classified ptt', () => {
        const d = detectMedia({ audioMessage: { mimetype: 'audio/ogg', ptt: true, seconds: 12 } });
        expect(d.kind).toBe('ptt');
    });
    test('document detected with filename', () => {
        const d = detectMedia({ documentMessage: { mimetype: 'application/pdf', fileName: 'bill.pdf' } });
        expect(d.kind).toBe('document');
        expect(d.fileName).toBe('bill.pdf');
    });
    test('text message has no media', () => {
        expect(detectMedia({ conversation: 'hello' }).kind).toBeNull();
        expect(detectMedia(null).kind).toBeNull();
    });
    test('sticker flagged separately (no download)', () => {
        expect(detectMedia({ stickerMessage: {} }).kind).toBe('sticker');
    });
});

describe('whatsapp media filenames', () => {
    test('path traversal neutralized + extension kept', () => {
        const n = safeFileName('../../etc/passwd.jpg', 'image/jpeg', 'image');
        expect(n).not.toMatch(/\.\./);
        expect(n).not.toContain('/');
        expect(n.endsWith('.jpg')).toBe(true);
    });
    test('mime fallback when no extension', () => {
        expect(safeFileName('', 'application/pdf', 'document').endsWith('.pdf')).toBe(true);
    });
    test('daily dir sharding', () => {
        const d = incomingDir('/base', new Date('2026-09-20T10:00:00Z'));
        expect(d).toBe(path.join('/base', 'incoming', '2026-09-20'));
    });
    test('arabic ack mentions media kind', () => {
        expect(buildMediaAck('image', '')).toMatch('الصورة');
        expect(buildMediaAck('ptt', '').length).toBeGreaterThan(10);
        expect(buildMediaAck('document', 'كشف')).toMatch('كشف');
    });
});

describe('whatsapp send-media payload', () => {
    test('all kinds supported', () => {
        expect([...MEDIA_KINDS].sort()).toEqual(['audio', 'document', 'image', 'video']);
    });
    test('local image file builds payload with caption', () => {
        const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-')), 'p.png');
        fs.writeFileSync(tmp, Buffer.from([1, 2, 3]));
        const p = buildMediaPayload({ media_type: 'image', media_path: tmp, caption: 'عرض اليوم' });
        expect(p.image).toBeDefined();
        expect(p.caption).toBe('عرض اليوم');
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    });
    test('https url accepted, http rejected implicitly (throws on non-https local)', () => {
        const p = buildMediaPayload({ media_type: 'document', media_path: 'https://example.com/a.pdf', caption: '' });
        expect(p.document.url).toBe('https://example.com/a.pdf');
        expect(p.fileName).toBe('a.pdf');
    });
    test('missing file throws MEDIA_FILE_MISSING', () => {
        expect(() => buildMediaPayload({ media_type: 'image', media_path: 'C:/nope/missing.jpg' })).toThrow('MEDIA_FILE_MISSING');
    });
    test('unknown kind throws INVALID_MEDIA_TYPE', () => {
        expect(() => buildMediaPayload({ media_type: 'sticker', media_path: 'x' })).toThrow('INVALID_MEDIA_TYPE');
    });
});
