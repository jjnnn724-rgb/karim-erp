/* pos-touch.js — لوحة أرقام لمسية لحقول الدفع
   ═══════════════════════════════════════════════════════════════════════════
   جهاز الكاشير ليس حاسوبًا مكتبيًا: غالبًا شاشة لمس بلا لوحة مفاتيح. حقول
   الدفع الأربعة (نقدي/بطاقة/محفظة/تحويل) كانت تعتمد على لوحة النظام؛ على
   شاشة لمس يفتح النظام لوحةً تغطي نصف الشاشة، وعلى أجهزة الويندوز اللوحية
   قد لا تظهر أصلًا. هنا لوحة أرقام داخل التطبيق: أرقام كبيرة، فاصلة عشرية
   واحدة، منزلتان، و«تم» تكتب القيمة وتُطلق حدث input نفسه الذي يستمع إليه
   منطق الدفع — فلا نسخة ثانية من الحساب.

   تُفعَّل تلقائيًا عند وجود مؤشر لمس خشن (pointer: coarse) فقط، حتى لا تظهر
   فوق كاشير يعمل بلوحة مفاتيح. */

(function () {
    'use strict';

    const FIELDS = ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'];
    const LABELS = {
        'pay-cash': 'المبلغ نقدًا',
        'pay-card': 'المبلغ على البطاقة',
        'pay-wallet': 'المبلغ على المحفظة',
        'pay-bank': 'مبلغ التحويل',
    };
    const MAX_INT_DIGITS = 7;

    let pad = null;
    let valueEl = null;
    let labelEl = null;
    let target = null;
    let buffer = '';

    function isCoarse() {
        try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
    }

    function renderValue() {
        valueEl.textContent = buffer === '' ? '0.00' : buffer;
    }

    function buildPad() {
        pad = document.createElement('div');
        pad.className = 'pay-keypad hidden';
        pad.setAttribute('role', 'dialog');
        pad.setAttribute('aria-label', 'إدخال المبلغ');

        const head = document.createElement('div');
        head.className = 'pay-keypad-head';
        labelEl = document.createElement('span');
        labelEl.id = 'pay-keypad-label';
        labelEl.textContent = 'المبلغ';
        valueEl = document.createElement('span');
        valueEl.className = 'pay-keypad-value';
        valueEl.setAttribute('aria-live', 'polite');
        valueEl.textContent = '0.00';
        head.append(labelEl, valueEl);
        pad.appendChild(head);

        const keys = [
            { key: '7' }, { key: '8' }, { key: '9' }, { key: 'back', label: 'حذف', aria: 'حذف رقم', cls: 'back' },
            { key: '4' }, { key: '5' }, { key: '6' }, { key: 'clear', label: 'C', aria: 'مسح الكل' },
            { key: '1' }, { key: '2' }, { key: '3' }, { key: '.' },
            { key: '00' }, { key: '0' }, { key: 'ok', label: 'تم', aria: 'تأكيد المبلغ', cls: 'ok wide' },
        ];
        for (const k of keys) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.key = k.key;
            btn.textContent = k.label || k.key;
            btn.setAttribute('aria-label', k.aria || (k.label ? k.label : k.key));
            if (k.cls) {btn.className = k.cls;}
            pad.appendChild(btn);
        }

        pad.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-key]');
            if (!btn) {return;}
            handleKey(btn.dataset.key);
        });

        document.body.appendChild(pad);
    }

    function decimalsOf(value) {
        const dot = value.indexOf('.');
        return dot === -1 ? 0 : value.length - dot - 1;
    }

    function append(chunk) {
        if (buffer === '' && chunk === '.') {
            buffer = '0.';
        } else if (chunk === '.') {
            if (buffer.indexOf('.') !== -1) {return;}
            buffer += '.';
        } else {
            const next = buffer + chunk;
            const intPart = next.split('.')[0];
            if (decimalsOf(next) > 2) {return;}
            if (intPart.replace(/^0+(?=\d)/, '').length > MAX_INT_DIGITS) {return;}
            buffer = next;
        }
        renderValue();
    }

    function handleKey(key) {
        if (key === 'ok') { return commit(); }
        if (key === 'clear') { buffer = ''; return renderValue(); }
        if (key === 'back') {
            buffer = buffer.endsWith('.') && buffer.length <= 2 ? '' : buffer.slice(0, -1);
            return renderValue();
        }
        if (key === '.') { return append('.'); }
        return append(key);
    }

    function commit() {
        if (!target) { return hide(); }
        const clean = buffer.replace(/\.$/, '');
        target.value = clean === '' ? '0' : clean;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        hide();
        target.blur();
        target = null;
    }

    function show(field) {
        if (!pad) { buildPad(); }
        target = field;
        const current = String(field.value || '').replace(/[^\d.]/g, '');
        buffer = current === '0' || current === '0.00' ? '' : current;
        labelEl.textContent = LABELS[field.id] || 'المبلغ';
        renderValue();
        pad.classList.remove('hidden');
    }

    function hide() {
        if (pad) { pad.classList.add('hidden'); }
    }

    function wireField(field) {
        // على شاشة لمس لا نريد لوحة النظام تغطي الواجهة: كل الإدخال من لوحتنا
        field.setAttribute('inputmode', 'none');
        field.setAttribute('autocomplete', 'off');

        field.addEventListener('focus', () => {
            if (!isCoarse()) { return; }
            show(field);
        });
        field.addEventListener('click', () => {
            if (!isCoarse()) { return; }
            if (pad && !pad.classList.contains('hidden') && target === field) { return; }
            show(field);
        });
        // لصق/كتابة بلوحة خارجية تبقى تعمل: نحدّث المخزن من القيمة المكتوبة
        field.addEventListener('input', () => {
            if (target !== field) { return; }
            buffer = String(field.value || '').replace(/[^\d.]/g, '');
            renderValue();
        });
    }

    function wire() {
        for (const id of FIELDS) {
            const field = document.getElementById(id);
            if (field) { wireField(field); }
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && pad && !pad.classList.contains('hidden')) { hide(); }
        });

        document.addEventListener('pointerdown', (event) => {
            if (!pad || pad.classList.contains('hidden')) { return; }
            if (pad.contains(event.target)) { return; }
            if (target && event.target === target) { return; }
            hide();
        }, true);

        // قائمة السياق الطويلة على بطاقة صنف تُربك الكاشير على شاشة اللمس
        const grid = document.getElementById('products-grid');
        if (grid) {
            grid.addEventListener('contextmenu', (event) => {
                if (isCoarse()) { event.preventDefault(); }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire, { once: true });
    } else {
        wire();
    }
}());
