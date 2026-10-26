/**
 * tests/whatsapp-pro.test.js — Templates send + session backup (no DB, no socket)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TemplateManager } = require('../backend/whatsapp-engine/templates');
const { backupSession, stampName, latestBackup, restoreLatest } = require('../backend/whatsapp-engine/session-backup');
const { supervisorDecision } = require('../backend/whatsapp-engine/supervisor');

describe('whatsapp templates render', () => {
    const tm = new TemplateManager();
    test('fill replaces {{1}}..{{n}} in order', () => {
        expect(tm.fill('Order #{{1}} total {{2}} SAR', '1285', '350')).toBe('Order #1285 total 350 SAR');
    });
    test('missing var becomes empty (never literal placeholder)', () => {
        expect(tm.fill('Hi {{1}} {{2}}', 'A')).toBe('Hi A ');
        expect(tm.fill('Hi {{1}} {{2}}', 'A')).not.toMatch(/\{\{/);
    });
    test('countVars = highest index', () => {
        expect(tm.countVars('A {{1}} B {{3}}')).toBe(3);
        expect(tm.countVars('no vars')).toBe(0);
        expect(tm.countVars('')).toBe(0);
    });
    test('cache invalidates on demand', () => {
        tm._cache.set('x:ar', { template: 'old', ts: Date.now() });
        tm.clearCache();
        expect(tm._cache.size).toBe(0);
    });
});

describe('whatsapp session backup', () => {
    test('stamp format sortable', () => {
        expect(stampName(new Date(2026, 8, 20, 10, 11, 12))).toBe('creds-20260920-101112.json');
    });
    test('copies creds and prunes to keep-N', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sess-'));
        const sess = path.join(base, 'sess');
        const bak = path.join(base, 'bak');
        fs.mkdirSync(sess, { recursive: true });
        fs.writeFileSync(path.join(sess, 'creds.json'), '{"me":"test"}');
        const first = backupSession(sess, bak, 2);
        expect(first).toBeTruthy();
        expect(JSON.parse(fs.readFileSync(first, 'utf-8')).me).toBe('test');
        // force 3 backups with distinct stamps
        const stamps = ['creds-20260920-101111.json', 'creds-20260920-101112.json', 'creds-20260920-101113.json'];
        for (const s of stamps) {fs.copyFileSync(path.join(sess, 'creds.json'), path.join(bak, s));}
        backupSession(sess, bak, 2);
        const left = fs.readdirSync(bak).filter((f) => f.startsWith('creds-'));
        expect(left.length).toBe(2);
        fs.rmSync(base, { recursive: true, force: true });
    });
    test('missing creds returns null (never throws)', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nocreds-'));
        expect(backupSession(path.join(base, 'empty'), path.join(base, 'bak'))).toBeNull();
        fs.rmSync(base, { recursive: true, force: true });
    });
    test('latestBackup picks newest; restoreLatest restores it', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-restore-'));
        const bak = path.join(base, 'bak');
        const sess = path.join(base, 'sess');
        fs.mkdirSync(bak, { recursive: true });
        fs.writeFileSync(path.join(bak, 'creds-20260920-101111.json'), '{"v":1}');
        fs.writeFileSync(path.join(bak, 'creds-20260920-101113.json'), '{"v":3}');
        expect(latestBackup(bak).endsWith('creds-20260920-101113.json')).toBe(true);
        const used = restoreLatest(bak, sess);
        expect(used.endsWith('101113.json')).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(sess, 'creds.json'), 'utf-8')).v).toBe(3);
        fs.rmSync(base, { recursive: true, force: true });
    });
    test('restoreLatest throws NO_BACKUP when empty', () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nobak-'));
        expect(() => restoreLatest(base, path.join(base, 's'))).toThrow('لا توجد نسخة احتياطية');
        fs.rmSync(base, { recursive: true, force: true });
    });
});

describe('whatsapp steel watchdog policy', () => {
    const H = 10 * 60 * 1000;
    test('heals after 10 stuck ticks with old heal', () => {
        expect(supervisorDecision('RECONNECTING', 10, H + 1)).toBe('heal');
        expect(supervisorDecision('FAILED', 15, H + 1)).toBe('heal');
    });
    test('no heal before 10 ticks or recent heal', () => {
        expect(supervisorDecision('RECONNECTING', 9, H + 1)).toBe('ok');
        expect(supervisorDecision('RECONNECTING', 10, H - 1)).toBe('ok');
    });
    test('healthy states never heal; logout waits for QR', () => {
        expect(supervisorDecision('CONNECTED', 99, H + 1)).toBe('ok');
        expect(supervisorDecision('QR_REQUIRED', 99, H + 1)).toBe('ok');
        expect(supervisorDecision('LOGGED_OUT', 99, H + 1)).toBe('wait_qr');
    });
});
