/* يختبر سياسة الكاش المُسبق لخدمة العمل الخلفية (frontend/app/sw.js) بآليتها الحقيقية:
   يُحمَّل الملف في سياقٍ معزول بـ fetch/caches وهميين، فيُشتقّ الكاش من الملفات
   الفعلية للصفحات كما هي في المستودع — لا من قائمةٍ يخطّئها الناس. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_FILE = path.join(__dirname, '..', 'frontend', 'app', 'sw.js');
const APP_DIR = path.join(__dirname, '..', 'frontend', 'app');
const ORIGIN = 'https://erp.test';

class FakeCache {
    constructor(name) {
        this.name = name;
        this.entries = [];   // [{ url, res }] — بترتيب الإضافة مثل Cache الحقيقية
    }

    async put(req, res) {
        const url = typeof req === 'string' ? req : req.url;
        this.entries = this.entries.filter((e) => e.url !== url);
        this.entries.push({ url, res });
    }

    async keys() {return this.entries.map((e) => ({ url: e.url }));}

    async match(req) {
        const url = typeof req === 'string' ? req : req.url;
        const hit = this.entries.find((e) => e.url === url);
        return hit ? hit.res : undefined;
    }

    async delete(req) {
        const url = typeof req === 'string' ? req : req.url;
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.url !== url);
        return this.entries.length < before;
    }

    async addAll() {throw new Error('addAll محظور: رفضٌ بأول مسارٍ يُسقط الكاش كله في صمت');}
}

function readRepoFile(urlKey) {
    const u = new URL(urlKey, ORIGIN);
    const abs = path.join(APP_DIR, u.pathname.replace(/^\/app\//, ''));
    if (!abs.startsWith(APP_DIR + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {return undefined;}
    return fs.readFileSync(abs, 'utf8');
}

/* قارئٌ من المستودع؛ opts.missing مساراتٌ تُعامَل 404 عند الحاجة */
function repoReader(opts = {}) {
    const missing = new Set(opts.missing || []);
    const files = new Map();
    const get = (urlKey) => {
        const u = new URL(urlKey, ORIGIN);
        const key = `${u.pathname}${u.search}`;
        if (missing.has(u.pathname)) {return undefined;}
        if (!files.has(key)) {files.set(key, readRepoFile(key));}
        return files.get(key);
    };
    return get;
}

/* يبني ملفاتهم من نصٍّ صريح: files = { '/app/index.html': '<html …>' } */
/* استجابةٌ وهمية بجسمٍ قابل للاستقلال: clone() يُخيّم النصَّ كما تفعل Response الحقيقية */
class FakeResponse {
    constructor(url, text) {
        this.ok = true;
        this.status = 200;
        this.url = url;
        this.headers = new Map();
        this._text = text;
    }

    clone() {return new FakeResponse(this.url, this._text);}

    async text() {return this._text;}
}

function notFound(url) {
    return { ok: false, status: 404, url, text: () => Promise.reject(new Error('404')) };
}

function makeSw({ files = {}, failing = () => false } = {}) {
    const cachesMap = new Map();
    const handlers = {};
    const asked = [];

    // files: خريطة urlKey->نص، أو دالة قراءة (urlKey) => نص | undefined
    const lookup = typeof files === 'function' ? files : (urlKey) => {
        for (const [key, text] of Object.entries(files)) {
            const u = new URL(key, ORIGIN);
            if (`${u.pathname}${u.search}` === urlKey) {return text;}
        }
        return undefined;
    };

    const fetchImpl = (req) => {
        const url = typeof req === 'string' ? req : req.url;
        const u = new URL(url, ORIGIN);
        const key = `${u.pathname}${u.search}`;
        asked.push(key);
        const text = failing(key) ? undefined : lookup(key);
        if (text === undefined) {return Promise.resolve(notFound(url));}
        return Promise.resolve(new FakeResponse(url, text));
    };

    const cacheStorage = {
        async open(name) {
            if (!cachesMap.has(name)) {cachesMap.set(name, new FakeCache(name));}
            return cachesMap.get(name);
        },
        async keys() {return [...cachesMap.keys()];},
        async delete(name) {return cachesMap.delete(name);},
    };

    const self = {
        location: { origin: ORIGIN },
        skipWaiting: () => undefined,
        clients: { claim: async () => undefined, matchAll: async () => [] },
        addEventListener: (type, fn) => {handlers[type] = fn;},
    };

    const context = vm.createContext({
        self, fetch: fetchImpl, caches: cacheStorage, URL, URLSearchParams, Response, Request,
        console: { log: () => undefined, warn: () => undefined, error: () => undefined },
        setTimeout, clearTimeout, Date, Math, JSON, Promise, Set, Map, Array, Object, String, Number, Boolean, RegExp, Error,
    });
    vm.runInContext(fs.readFileSync(SW_FILE, 'utf8'), context, { filename: 'sw.js' });

    const evalIn = (src) => vm.runInContext(src, context);
    const names = () => evalIn('[CACHE, STATIC_CACHE, API_CACHE, IMAGE_CACHE, FONT_CACHE]');

    const fire = async (type, eventInit = {}) => {
        const fn = handlers[type];
        if (!fn) {throw new Error(`لا معالج لـ ${type}`);}
        let pending = Promise.resolve();
        fn({ ...eventInit, waitUntil: (p) => {pending = Promise.resolve(p);} });
        await pending;
    };

    /* كل المخزَّن مفاتيحٌ مطلقة؛ نُعيدُها نسبية كما تُكتب في القائمة */
    const stored = async () => {
        const out = [];
        for (const [name, cache] of cachesMap) {
            for (const r of await cache.keys()) {out.push({ cache: name, key: new URL(r.url).pathname + new URL(r.url).search });}
        }
        return out;
    };

    return { self, handlers, fire, asked, evalIn, names, stored, cachesMap, context,
        assetKey: (raw, base) => evalIn('assetKey')(raw, base),
        seedCache: async (cacheName, keys) => {
            const cache = await cacheStorage.open(cacheName);
            for (const key of keys) {await cache.put(new URL(key, ORIGIN).href, { ok: true, status: 200 });}
            return cache;
        } };
}

module.exports = { makeSw, readRepoFile, repoReader, ORIGIN, SW_FILE, APP_DIR };
