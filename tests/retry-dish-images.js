// إعادة محاولة الأطباق التي جاءت صورتها غير مطابقة — بمصطلحات أدق
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'frontend', 'app', 'img', 'pos');
const UA = 'KarimERP/4.9 (restaurant menu; contact: owner)';

const RETRY = [
    { slug: 'kabsa-meat', terms: ['mandi meat rice', 'lamb mandi', 'kabsa saudi', 'meat rice arabic dish'] },
    { slug: 'grilled-chicken-half', terms: ['chicken tawook plate', 'grilled chicken breast rice plate', 'chicken shish with rice'] },
    { slug: 'grilled-chicken-whole', terms: ['rotisserie chicken rice', 'roasted whole chicken rice dish', 'grilled chicken platter rice'] },
    { slug: 'aedam-mezze', terms: ['mezze platter', 'middle eastern appetizers table', 'hummus fattoush tabbouleh'] },
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
        + '&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=640&format=json';
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
    for (const dish of RETRY) {
        const out = path.join(OUT_DIR, dish.slug + '.jpg');
        for (const term of dish.terms) {
            try {
                const found = await searchImage(term);
                if (!found) {continue;}
                const img = await get(found.url);
                const magic = img.body.slice(0, 4);
                const isImg = (magic[0] === 0xFF && magic[1] === 0xD8) || (magic[0] === 0x89 && magic[1] === 0x50);
                if (!isImg || img.body.length < 15000) {continue;}
                fs.writeFileSync(out, img.body);
                console.log(`✓ ${dish.slug} ← ${found.title} [${term}]`);
                break;
            } catch (e) { console.log(`  تعذر "${term}": ${e.message}`); }
        }
    }
    console.log('انتهت إعادة المحاولة');
})();
