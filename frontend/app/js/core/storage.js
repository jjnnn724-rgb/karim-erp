/**
 * core/storage.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// STORAGE
// ============================================
async function initDatabase() {
    const response = await fetch(API_BASE + '/health');
    if (!response.ok) {throw new Error('فشل الاتصال بالخادم');}
    const data = await response.json();
    const dbComp = data.components?.find(x => x.component === 'database');
    if (data.status !== 'ok' && dbComp?.status !== 'ok') {throw new Error(serverMessage(data, 'قاعدة البيانات غير متاحة'));}
    console.log('%c[HRP] Backend connected — ' + (data.checks?.realtime?.connectedClients ?? data.connectedClients ?? 0) + ' device(s) online', 'color:#08875c;font-weight:bold');
    return true;
}
// ═══════════════════════════════════════════════════════════════
//  saveData — نسخة محسّنة (Debounced + Coalesced + Retry)
//  • عند الإضافة/الحذف المتتالي: تُجمَع الطلبات في POST واحد
//  • مقاومة انقطاع الشبكة: 3 محاولات مع backoff تصاعدي
//  • لا تحجب واجهة المستخدم مهما كان الحجم
// ═══════════════════════════════════════════════════════════════
const _SAVE_DEBOUNCE_MS = 250;
let _saveTimer = null;
let _saveInFlight = null;   // Promise للحفظ الجاري
let _savePending = false;   // هل هناك تغييرات لم تُحفظ بعد؟
let _saveAbortCtrl = null;

function uiPreferencesPayload(){ return { lang: STATE.lang === 'en' ? 'en' : 'ar', theme: STATE.theme === 'light' ? 'light' : 'dark' }; }
async function _doSaveOnce() {
    if (_saveAbortCtrl) { try { _saveAbortCtrl.abort(); } catch(_){} }
    _saveAbortCtrl = new AbortController();
    const stateStr = JSON.stringify(uiPreferencesPayload());
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(API_BASE + '/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: stateStr,
                signal: _saveAbortCtrl.signal,
                keepalive: stateStr.length < 60_000 // للمساعدة عند إغلاق الصفحة
            });
            if (response.ok) {return true;}
            let message = 'فشل حفظ البيانات في قاعدة البيانات';
            try {
                const data = await response.json();
                const m = serverMessage(data, null);
                if (m) {message = m;}
            } catch (e) {}
            // خطأ 4xx: لا نُعيد المحاولة
            if (response.status >= 400 && response.status < 500) {
                throw new Error(message);
            }
            throw new Error(message);
        } catch (e) {
            if (e.name === 'AbortError') {return false;} // تم إلغاؤه لصالح طلب أحدث
            if (attempt === maxAttempts) {
                console.error('Save error (final):', e);
                if(window.toast) {toast('تعذر الحفظ — ستتم المحاولة تلقائياً', 'error');}
                return false;
            }
            // Exponential backoff: 300ms → 800ms → 2s
            await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
        }
    }
    return false;
}

async function _flushSave() {
    if (_saveInFlight) {
        // هناك حفظ جارٍ — علّم أن هناك تغييرات جديدة، وسنعيد المحاولة بعد الانتهاء
        _savePending = true;
        return _saveInFlight;
    }
    _saveInFlight = (async () => {
        try {
            do {
                _savePending = false;
                await _doSaveOnce();
            } while (_savePending);
        } finally {
            _saveInFlight = null;
        }
    })();
    return _saveInFlight;
}

async function saveData(immediate = false) {
    if (immediate) {
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
        return _flushSave();
    }
    // Debounce: امنع طوفان الطلبات عند النقرات المتتالية
    if (_saveTimer) {clearTimeout(_saveTimer);}
    return new Promise((resolve) => {
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            _flushSave().then(resolve);
        }, _SAVE_DEBOUNCE_MS);
    });
}

// حفظ فوري عند إغلاق الصفحة (يستفيد من keepalive في _doSaveOnce)
window.addEventListener('beforeunload', () => {
    if (_saveTimer || _saveInFlight || _savePending) {
        try {
            navigator.sendBeacon &&
              navigator.sendBeacon(API_BASE + '/state',
                new Blob([JSON.stringify(uiPreferencesPayload())], {type:'application/json'}));
        } catch(_){}
    }
});
async function loadData() {
    // Only UI/session-level preferences still come from the single-row blob
    // (kept for backward compatibility with the classic /api/state route).
    try {
        const legacy = await fetch(API_BASE + '/state');
        if (legacy.ok) {
            const data = await legacy.json();
            // لغة الجهاز المحفوظة تتفوق على القيمة المشتركة في الخادم
            const localLang = readLangLocal();
            if (localLang) { STATE.lang = localLang; }
            else if (data) {
                if (data.lang) {STATE.lang = data.lang;}
            }
            if (data) {
                if (data.theme) {STATE.theme = data.theme;}
            }
        }
    } catch (e) { /* non-fatal — settings table below is authoritative anyway */ }

    // Settings: real row in the `settings` table (id = 'main_settings').
    try {
        const s = await apiFetch('/settings/main_settings');
        if (s) {STATE.settings = s;}
    } catch (e) {
        console.warn('Could not load settings from DB, using defaults:', e.message);
    }

    // Every business entity now comes directly from its own PostgreSQL
    // table via the authenticated REST API — this is the real source of
    // truth (see PERSISTED_ENTITIES above).
    const bootExclusions = ROLE_ENTITY_EXCLUSIONS[STATE.currentUser?.role] || [];
    const bootEntities = PERSISTED_ENTITIES.filter(e => !bootExclusions.includes(e));
    const nonAttendance = bootEntities.filter(e => e !== 'attendance');
    // الذيل كان أربعة استدعاءات متسلسلة بعد دفعة الكيانات (حضور + كتالوج + مطبخ +
    // مشتريات) — كل منها ثانية انتظار على شبكة الجوال. كلها مستقلة عن الكيانات،
    // فتُطلق بالتوازي مع الدفعة وتُنتظر معها مرة واحدة.
    const entitiesBatch = Promise.allSettled(nonAttendance.map(e => apiList(e)));
    const tailBatch = Promise.allSettled([
        (async () => {
            // Attendance: load from month start (old history was purged on owner request)
            const d1 = new Date(); d1.setDate(1);
            const attFrom = STATE.attFrom || d1.toISOString().slice(0, 10);
            const attTo = STATE.attTo || today();
            try {
                const attRes = await apiFetch(`/attendance/range?from=${attFrom}&to=${attTo}&limit=30000`);
                STATE.attendance = Array.isArray(attRes?.data) ? attRes.data : [];
                return true;
            } catch (e) {
                console.warn('Could not load attendance range:', e.message);
                try { STATE.attendance = await apiList('attendance'); return true; } catch (_) { STATE.attendance = []; return false; }
            }
        })(),
        (async () => {
            try {
                const catalog = await apiFetch('/pos/recipes/catalog');
                STATE.recipeCatalog = Object.fromEntries((Array.isArray(catalog) ? catalog : []).map(row => [String(row.recipe_id), row]));
            } catch (e) {
                console.warn('Could not load recipe catalog:', e.message);
            }
        })(),
        (async () => {
            try { STATE.kitchenOps = await apiFetch('/kitchen/overview'); } catch (e) { console.warn('Could not load kitchen overview:', e.message); }
        })(),
        (async () => {
            try { await refreshProcurementData(); } catch (e) { console.warn('Could not load procurement data:', e.message); }
        })(),
    ]);
    const results = await entitiesBatch;
    const tail = await tailBatch;
    let anyLoaded = false;
    nonAttendance.forEach((entity, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            STATE[entity] = entity === 'recipes'
                ? r.value.map(recipe => ({
                    ...recipe,
                    sellingPrice: Number(recipe.sellingPrice || 0),
                    totalCost: Number(recipe.totalCost || 0),
                    costRatio: Number(recipe.costRatio || 0),
                }))
                : r.value;
            anyLoaded = true;
        } else {
            console.error(`<i class=ji data-i=alert-triangle></i> Failed to load "${entity}" from PostgreSQL:`, r.reason?.message || r.reason);
        }
    });
    // الحضور يُحمَّل في الذيل المتوازي — كان سابقًا سببًا آخر لـ anyLoaded
    if (tail[0] && tail[0].status === 'fulfilled' && tail[0].value) {anyLoaded = true;}
    return anyLoaded;
}
// Production mode: no client-side seed data. All business entities are loaded from PostgreSQL above.

// عنقود البطاقة الذكية + تقارير الحضور المطبوعة: نُقل إلى js/features/smart-card.js (يجسر عبر js/main.js — BRIDGE-008)
// عنقود الاستيراد الجماعي: نُقل إلى js/features/bulk-import.js (يجسر عبر js/main.js — BRIDGE-009)

export { initDatabase, _SAVE_DEBOUNCE_MS, _saveTimer, _saveInFlight, _savePending, _saveAbortCtrl, uiPreferencesPayload, _doSaveOnce, _flushSave, saveData, loadData };
