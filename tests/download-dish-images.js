// تنزيل صور حقيقية للأطباق من ويكيميديا كومنز (ترخيص حر) — بديل الصور الافتراضية
// لكل طبق: مصطلح بحث أساسي + احتياطي. الصور 640px إلى frontend/app/img/pos/
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'frontend', 'app', 'img', 'pos');
const UA = 'KarimERP/4.9 (restaurant menu; contact: owner)';

const DISHES = [
    { slug: 'kabsa-chicken', terms: ['kabsa chicken', 'chicken kabsa rice'] },
    { slug: 'kabsa-meat', terms: ['kabsa meat', 'lamb kabsa'] },
    { slug: 'biryani-chicken', terms: ['chicken biryani', 'biryani'] },
    { slug: 'grilled-chicken-quarter', terms: ['grilled chicken rice plate', 'shish tawook rice'] },
    { slug: 'grilled-chicken-half', terms: ['grilled chicken and rice', 'roast chicken rice'] },
    { slug: 'grilled-chicken-whole', terms: ['roasted chicken platter', 'grilled whole chicken rice'] },
    { slug: 'aedam-mezze', terms: ['mezze arabic', 'arabic salad hummus'] },
    { slug: 'lentil-soup', terms: ['lentil soup bowl', 'shorba adas'] },
    { slug: 'macarona-bechamel', terms: ['macarona bechamel', 'bechamel pasta bake'] },
];

function get(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 4) {return reject(new Error('too many redirects'));}
        https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), type: res.headers['content-type'] || '' }));
        }).on('error', reject);
    });
}

async function searchImage(term) {
    const api = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search'
        + '&gsrnamespace=6&gsrsearch=' + encodeURIComponent('filetype:bitmap ' + term)
        + '&gsrlimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=640&format=json';
    const { body } = await get(api);
    const j = JSON.parse(body.toString('utf8'));
    const pages = Object.values((j.query || {}).pages || {});
    for (const p of pages) {
        const info = (p.imageinfo || [])[0];
        if (!info) {continue;}
        if (!/jpe?g|png/i.test(info.mime || '')) {continue;}
        const url = info.thumburl || info.url;
        if (url) {return { url, title: p.title };}
    }
    return null;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const dish of DISHES) {
        const out = path.join(OUT_DIR, dish.slug + '.jpg');
        if (fs.existsSync(out) && fs.statSync(out).size > 15000) { console.log(`موجود مسبقًا: ${dish.slug}`); continue; }
        let done = false;
        for (const term of dish.terms) {
            try {
                const found = await searchImage(term);
                if (!found) {continue;}
                const img = await get(found.url);
                const magic = img.body.slice(0, 4);
                const isImg = (magic[0] === 0xFF && magic[1] === 0xD8) || (magic[0] === 0x89 && magic[1] === 0x50);
                if (!isImg || img.body.length < 12000) {continue;}
                fs.writeFileSync(out, img.body);
                console.log(`✓ ${dish.slug} ← ${found.title} (${Math.round(img.body.length / 1024)}KB) [${term}]`);
                done = true;
                break;
            } catch (e) { console.log(`  تعذر "${term}": ${e.message}`); }
        }
        if (!done) { console.log(`✗ ${dish.slug} — لم تُجد صورة مناسبة (سيبقى بلا صورة)`); }
    }
    console.log('انتهى التنزيل →', OUT_DIR);
})();
