/**
 * menu-legacy-routes.js — روابط شاشات المنيو + بوفيه الملف (مُستخلص من server.js)
 * مسارات مختصرة للجمهور والشاشات + API بوفيه الشرفة المبني على ملف JSON
 * مع بث فوري للشاشات. (اللوحة الرسمية الحالية: menu-board-routes.js)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { logger } = require('./logger');

const BUFFET_DATA_FILE = path.resolve(__dirname, '..', 'database', 'data', 'buffet-menu.json');

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

    app.post('/api/buffet-menu', express.json({ limit: '2mb' }), (req, res) => {
        try {
            const payload = req.body;
            if (!payload || typeof payload !== 'object') {
                return res.status(400).json({ error: 'INVALID_PAYLOAD' });
            }
            const dir = path.dirname(BUFFET_DATA_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(BUFFET_DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
            try {
                io.emit('buffet_menu_updated', payload);
            } catch (_) {}
            res.json({ ok: true, timestamp: Date.now() });
        } catch (e) {
            logger.error('[buffet-menu] Save error:', e.message);
            res.status(500).json({ error: 'SAVE_FAILED' });
        }
    });
}

module.exports = { register };
