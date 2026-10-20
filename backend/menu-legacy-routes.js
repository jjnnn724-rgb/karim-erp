/**
 * menu-legacy-routes.js — روابط شاشات المنيو + بوفيه الملف (مُستخلص من server.js)
 * مسارات مختصرة للجمهور والشاشات + API بوفيه الشرفة المبني على ملف JSON
 * مع بث فوري للشاشات. (اللوحة الرسمية الحالية: menu-board-routes.js)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { logger } = require('./logger');
const { jwtAuth } = require('./cashier-module/jwt-middleware');

const BUFFET_DATA_FILE = path.resolve(__dirname, '..', 'database', 'data', 'buffet-menu.json');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function validateBuffetPayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'INVALID_PAYLOAD' };
    }
    // restaurant
    if (payload.restaurant) {
        const r = payload.restaurant;
        if (r.nameAr !== undefined && (typeof r.nameAr !== 'string' || r.nameAr.length > 200)) errors.push('restaurant.nameAr');
        if (r.nameEn !== undefined && (typeof r.nameEn !== 'string' || r.nameEn.length > 200)) errors.push('restaurant.nameEn');
        if (r.ticker !== undefined && (typeof r.ticker !== 'string' || r.ticker.length > 500)) errors.push('restaurant.ticker');
        if (r.buffetPrice !== undefined && (typeof r.buffetPrice !== 'number' || r.buffetPrice < 0 || r.buffetPrice > 100000)) errors.push('restaurant.buffetPrice');
    }
    // categories
    if (payload.categories !== undefined) {
        if (!Array.isArray(payload.categories)) {
            errors.push('categories');
        } else {
            for (let i = 0; i < payload.categories.length; i++) {
                const c = payload.categories[i];
                if (!c || typeof c !== 'object') { errors.push(`categories[${i}]`); continue; }
                if (c.nameAr !== undefined && (typeof c.nameAr !== 'string' || c.nameAr.length > 200)) errors.push(`categories[${i}].nameAr`);
                if (c.nameEn !== undefined && (typeof c.nameEn !== 'string' || c.nameEn.length > 200)) errors.push(`categories[${i}].nameEn`);
                if (c.icon !== undefined && typeof c.icon !== 'string') errors.push(`categories[${i}].icon`);
                if (Array.isArray(c.items)) {
                    for (let j = 0; j < c.items.length; j++) {
                        const it = c.items[j];
                        if (!it || typeof it !== 'object') { errors.push(`categories[${i}].items[${j}]`); continue; }
                        if (it.nameAr !== undefined && (typeof it.nameAr !== 'string' || it.nameAr.length > 200)) errors.push(`categories[${i}].items[${j}].nameAr`);
                        if (it.nameEn !== undefined && (typeof it.nameEn !== 'string' || it.nameEn.length > 200)) errors.push(`categories[${i}].items[${j}].nameEn`);
                        if (it.meal !== undefined && !Array.isArray(it.meal)) errors.push(`categories[${i}].items[${j}].meal`);
                    }
                }
            }
        }
    }
    return errors.length ? { ok: false, error: 'VALIDATION_ERROR', fields: errors } : { ok: true };
}

function sanitizeBuffetPayload(payload) {
    const out = JSON.parse(JSON.stringify(payload));
    if (out.restaurant) {
        const r = out.restaurant;
        if (typeof r.nameAr === 'string') r.nameAr = escapeHtml(r.nameAr);
        if (typeof r.nameEn === 'string') r.nameEn = escapeHtml(r.nameEn);
        if (typeof r.ticker === 'string') r.ticker = escapeHtml(r.ticker);
    }
    if (Array.isArray(out.categories)) {
        for (const c of out.categories) {
            if (!c || typeof c !== 'object') continue;
            if (typeof c.nameAr === 'string') c.nameAr = escapeHtml(c.nameAr);
            if (typeof c.nameEn === 'string') c.nameEn = escapeHtml(c.nameEn);
            if (typeof c.icon === 'string') c.icon = escapeHtml(c.icon);
            if (Array.isArray(c.items)) {
                for (const it of c.items) {
                    if (!it || typeof it !== 'object') continue;
                    if (typeof it.nameAr === 'string') it.nameAr = escapeHtml(it.nameAr);
                    if (typeof it.nameEn === 'string') it.nameEn = escapeHtml(it.nameEn);
                }
            }
        }
    }
    return out;
}

function register(app, opts = {}) {
    const { io } = opts;

    // Root redirect
    app.get('/', (req, res) => {
        res.redirect('/app/index.html');
    });

    // ─── مسارات شاشة المنيو والداشبورد السهلة ───
    // شاشة العرض الرسمية (Totem) — تُفتح على شاشة المطعم وتقرأ من قاعدة بيانات الكاشير
    app.get('/menu', (req, res) => {
        res.redirect('/app/menu-board.html');
    });
    // لوحة التحكم — محمية بحساب أدمن/مدير/شيف (نفس صلاحيات نظام ERP)
    app.get('/menu-admin', (req, res) => {
        res.redirect('/app/menu-admin.html');
    });
    app.get('/totem', (req, res) => {
        res.redirect('/app/menu-board.html');
    });

    // ─── API بوفيه الشرفة المفتوح (قراءة وحفظ وبث فوري للشاشات) ───
    app.get('/api/buffet-menu', (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            if (fs.existsSync(BUFFET_DATA_FILE)) {
                const raw = fs.readFileSync(BUFFET_DATA_FILE, 'utf8');
                return res.json({ ok: true, data: JSON.parse(raw) });
            }
        } catch (e) {
            logger.warn('[buffet-menu] Read error:', e.message);
        }
        res.json({ ok: false, data: null });
    });

    app.post('/api/buffet-menu', express.json({ limit: '2mb' }), jwtAuth, (req, res) => {
        try {
            const payload = req.body;
            const validation = validateBuffetPayload(payload);
            if (!validation.ok) {
                return res.status(400).json({ error: validation.error, fields: validation.fields });
            }
            const safe = sanitizeBuffetPayload(payload);
            const dir = path.dirname(BUFFET_DATA_FILE);
            if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
            fs.writeFileSync(BUFFET_DATA_FILE, JSON.stringify(safe, null, 2), 'utf8');
            try {
                io.emit('buffet_menu_updated', safe);
            } catch (_) {}
            res.json({ ok: true, timestamp: Date.now() });
        } catch (e) {
            logger.error('[buffet-menu] Save error:', e.message);
            res.status(500).json({ error: 'SAVE_FAILED' });
        }
    });
}

module.exports = { register };
