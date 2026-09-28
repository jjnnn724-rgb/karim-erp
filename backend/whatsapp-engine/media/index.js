/**
 * whatsapp-engine/media/index.js — Media receive + store (images, docs, audio, video)
 * ────────────────────────────────────────────────────────────────────────────
 * - detectMedia(msg): pure — returns { kind: 'image'|'video'|'audio'|'document'|'ptt'|null, node }
 * - saveIncoming(sock, msg, kind, node, cfg): downloads via Baileys, writes to
 *   WHATSAPP_MEDIA_DIR/incoming/YYYY-MM-DD/, enforces MEDIA_MAX_SIZE_MB.
 * - buildMediaAck(kind, hasCaption): short Arabic acknowledgment text.
 * - All pure helpers are unit-tested (tests/whatsapp-media.test.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../../logger');

const KINDS = new Set(['image', 'video', 'audio', 'document']);

function mediaNodeOf(message) {
    if (!message || typeof message !== 'object') {return { kind: null, node: null };}
    if (message.imageMessage) {return { kind: 'image', node: message.imageMessage };}
    if (message.videoMessage) {return { kind: 'video', node: message.videoMessage };}
    if (message.audioMessage) {
        return { kind: message.audioMessage.ptt ? 'ptt' : 'audio', node: message.audioMessage };
    }
    if (message.documentMessage) {return { kind: 'document', node: message.documentMessage };}
    if (message.stickerMessage) {return { kind: 'sticker', node: message.stickerMessage };}
    return { kind: null, node: null };
}

/** Pure: classify incoming message media (null = no downloadable media) */
function detectMedia(message) {
    const { kind, node } = mediaNodeOf(message);
    if (!kind || !node) {return { kind: null };}
    if (kind === 'sticker') {return { kind: 'sticker' };}
    return {
        kind,
        mime: String(node.mimetype || ''),
        fileName: String(node.fileName || ''),
        caption: String(node.caption || ''),
        seconds: Number(node.seconds || 0),
    };
}

/** Pure: safe stored filename — keeps extension, kills path traversal */
function safeFileName(original, mime, kind) {
    const extFrom = (n) => {
        const m = String(n || '').match(/\.([a-z0-9]{1,5})$/i);
        return m ? '.' + m[1].toLowerCase() : '';
    };
    const extMime = (m) => {
        const map = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
            'video/mp4': '.mp4', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
            'application/pdf': '.pdf',
        };
        return map[String(m || '').split(';')[0].trim()] || '';
    };
    const ext = extFrom(original) || extMime(mime) || (kind === 'ptt' ? '.ogg' : '.bin');
    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

/** Pure: media dir for today */
function incomingDir(baseDir, now = new Date()) {
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return path.join(baseDir, 'incoming', d);
}

/** Pure: short Arabic acknowledgment for received media */
function buildMediaAck(kind, caption) {
    const label = { image: 'الصورة', video: 'الفيديو', audio: 'المقطع الصوتي', ptt: 'الرسالة الصوتية', document: 'المستند' }[kind] || 'الملف';
    let s = `تم استلام ${label} بنجاح — مطاعم الشرفه العالمي.`;
    if (caption) {s += `\nالتعليق: ${String(caption).slice(0, 200)}`;}
    s += `\nسيقوم فريقنا بمراجعتها والرد عليكم.`;
    return s;
}

/**
 * Download incoming media via Baileys socket and persist to disk.
 * Returns { kind, mime, fileName, path, size } or throws with safe code.
 */
async function saveIncoming(sock, fullMsg, detected, cfg) {
    if (!sock || typeof require('baileys').downloadMediaMessage !== 'function') {
        throw new Error('MEDIA_NOT_SUPPORTED');
    }
    const maxBytes = Math.max(1, Math.min(100, Number(cfg?.maxMediaSizeMB || 16))) * 1024 * 1024;
    const { downloadMediaMessage } = require('baileys');
    let buffer;
    try {
        buffer = await Promise.race([
            downloadMediaMessage(fullMsg, 'buffer', {}, { logger: undefined, reuploadRequest: sock.updateMediaMessage }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('MEDIA_TIMEOUT')), 60000)),
        ]);
    } catch (e) {
        throw new Error('MEDIA_DOWNLOAD_FAILED', { cause: e });
    }
    if (!buffer || !buffer.length) {throw new Error('MEDIA_EMPTY');}
    if (buffer.length > maxBytes) {throw new Error('MEDIA_TOO_LARGE');}
    const base = (cfg?.mediaDir || 'C:/KarimData/whatsapp-media').trim();
    const dir = incomingDir(base);
    fs.mkdirSync(dir, { recursive: true });
    const stored = safeFileName(detected.fileName, detected.mime, detected.kind);
    const full = path.join(dir, stored);
    fs.writeFileSync(full, buffer);
    try { logger.info(`[WHATSAPP] media saved: ${detected.kind} ${(buffer.length / 1024).toFixed(0)}KB -> ${full}`); } catch (_) {}
    return { kind: detected.kind, mime: detected.mime, fileName: stored, path: full, size: buffer.length };
}

module.exports = { detectMedia, safeFileName, incomingDir, buildMediaAck, saveIncoming, KINDS };
