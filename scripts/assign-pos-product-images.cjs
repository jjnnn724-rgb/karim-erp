#!/usr/bin/env node
/**
 * assign-pos-product-images.cjs
 * ────────────────────────────────────────────────────────────────────────────
 * يمنح كل صنف في `pos_products` صورة من مكتبة `v3/apps/web/public/img/pos`
 * (`pos-<family>.webp`) بناءً على اسم الصنف العربي/الإنجليزي ثم فئته، مع بديل
 * ثابت (hash) للأصناف التي لا يطابق اسمها أي عائلة.
 *
 * الصور ملفات محلية تُخدَم من `/v3/img/pos/…` — لا روابط خارجية في التشغيل.
 * لا يُستبدل ملف رُفع يدويًا (`product-*.jpg`) لأن القائمة تعرض صورة الصنف الحقيقية.
 *
 * الاستخدام:
 *   node scripts/assign-pos-product-images.cjs --dry --list
 *   node scripts/assign-pos-product-images.cjs --db=karim_erp_v2
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
// الصور أصول الواجهة: تُبنى مع `v3` وتُخدَم تحت `/v3/img/pos/` في كل البيئات.
const MEDIA_DIR = path.join(ROOT, 'v3', 'apps', 'web', 'public', 'img', 'pos');
const URL_PREFIX = '/v3/img/pos/';

function readEnv() {
    const env = {};
    const file = path.join(ROOT, '.env');
    if (!fs.existsSync(file)) return env;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = /^([A-Za-z_0-9]+)=(.*)$/.exec(line.trim());
        if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return env;
}

/** تطبيع الاسم العربي: بلا تشكيل ولا تطويل، وهمزات/ياء موحّدة، وحروف لاتينية صغيرة. */
function normalize(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** قواعد الاسم — الأكثر تحديدًا أولًا. */
const NAME_RULES = [
    ['buffet', ['بوفيه', 'بوفية', 'اوبن بوفيه', 'open buffet']],
    ['indonesian', ['sate', 'satay', 'nasi goreng', 'nasi lemak', 'nasi campur', 'nasi putih', 'bakso', 'soto', 'coto', 'kikil', 'kerupuk', 'kuih', 'bakwan', 'bihun', 'mie goreng', 'gado', 'rendang', 'nasi dagang', 'nasi ikan', 'nasi daging', 'nasi ayam', 'ayam bakar', 'telur', 'sop bun', 'coto makassar']],
    ['soda', ['بيبسي', 'كوكاكولا', 'كوكا كولا', 'كولا', 'سفن اب', 'ميراندا', 'ماونت ديو', 'مونتن ديو', 'حمضيات', 'فيمتو', 'ريدبول', 'فخفخينا', 'عوار قلب', 'pepsi', 'cola']],
    ['water', ['مياه', 'ماء', 'water']],
    ['tea', ['شاي', 'شاهي', 'كرك', 'tea']],
    ['juice', ['عصير', 'كاسة', 'جالون', 'مانجو', 'برتقال', 'رمان', 'افوكادو', 'فراوله', 'فروله', 'جوافه', 'ليمون نعناع', 'كوكتيل', 'بطيخ', 'حبحب', 'شمام', 'اناناس', 'تفاح', 'فروت ميكس', 'طبقات', 'سلطة فواكه', 'juice', 'smoothie']],
    ['salad', ['سلطه', 'سلطة', 'تبوله', 'فتوش', 'خضار', 'salad']],
    ['dessert', ['ارز بالحليب', 'رز بالحليب']],
    ['milk', ['حليب', 'لبن', 'milk']],
    ['mocktail', ['موهيتو', 'mojito', 'سلاش', 'slush', 'ميلك شيك', 'milkshake']],
    ['coffee', ['قهوه', 'قهوة', 'لاتيه', 'كابتشينو', 'كبتشينو', 'امريكانو', 'اسبريسو', 'سبرسو', 'موكا', 'ميكاتو', 'فلات وايت', 'سبنش', 'سبانش', 'v60', 'كودرد', 'نسكافيه', 'فرنسي', 'دله عربي', 'بلاك كوفي', 'سنقل شوت', 'هوت شوكلت', 'ايس شوكلت', 'كرميل', 'كارمل', 'توفي', 'بندق', 'فانيليا', 'coffee', 'latte', 'espresso']],
    ['arabic-sweets', ['بقلاوه', 'بلح', 'تمر', 'معمول', 'حلا شرقي', 'بسبوسه']],
    ['cake', ['تورتة', 'تورت', 'كيك', 'كيكة', 'تشيز', 'سويسرول', 'انجلش كيك', 'كب كيك', 'تراميسيو', 'cheesecake']],
    ['dessert', ['حلويات', 'حلا', 'حلي', 'كنافه', 'كريم كرمل', 'مهلبيه', 'جيلي', 'ارز بالحليب', 'ايس كريم', 'دونات', 'كوكيز', 'مافن', 'نوتيلا', 'لوتس', 'بلوبيري', 'راسبيري', 'بستاشيو', 'سباستيان', 'روزيه', 'dessert']],
    ['fries', ['بطاطس', 'بطاطا', 'fries']],
    ['snack', ['سمبوسه', 'سنبوسه', 'كرواسون', 'فطيره', 'معجنات', 'samosa', 'croissant']],
    ['fish', ['سمك', 'جمبري', 'روبيان', 'سلمون', 'fish', 'shrimp']],
    ['shawarma', ['شاورما', 'shawarma']],
    ['kebab', ['كباب', 'كفته', 'كبه', 'kebab', 'kofta']],
    ['sandwich', ['ساندوتش', 'سندوتش', 'رول', 'فاهيتا', 'فلافل', 'ديناميت', 'عرايسي', 'sandwich', 'wrap']],
    ['grilled-chicken', ['دجاجه مشويه', 'دجاجة مشوية', 'دجاج مشوي', 'حنيذ', 'شوايه دجاج', 'grilled chicken']],
    ['mixed-grill', ['مشويات', 'مشاوي', 'مشكل فرن', 'شوايه', 'مشكل خضار', 'وجبه عائليه', 'وجبة عائلية', 'وجبه موظف', 'وجبة موظف', 'وجبه', 'وجبة', 'box', 'grill', 'mixed']],
    ['curry', ['كاري', 'ايدام', 'curry']],
    ['kabsa-chicken', ['كبسه دجاج', 'كبسة دجاج', 'برياني', 'مندي دجاج', 'حبة دجاج', 'حبه دجاج', 'نص دجاج', 'ربع دجاج', 'دجاج مع الارز', 'دجاجه مع الارز', 'ارز مع الدجاج', 'بريانى', 'kabsa', 'biryani']],
    ['kabsa-meat', ['كبسه لحم', 'كبسة لحم', 'لحم مندي', 'نفر لحم', 'مندي لحم', 'لحم مع الارز', 'لحم ضاني', 'lamb', 'mandi']],
    ['rice', ['ارز ساده', 'ارز', 'رز', 'rice']],
    ['pasta', ['مكرونه', 'معكرونه', 'بشاميل', 'بشمل', 'فيوتشيني', 'فوتشيني', 'نودلز', 'pasta', 'penne']],
    ['soup', ['شوربه', 'شوربة', 'حساء', 'عكاوي', 'حريري', 'soup']],
    ['mezze', ['حمص', 'متبل', 'بابا غنوج', 'مقبلات', 'ورق عنب', 'محشي', 'طحينه', 'زبادي', 'لبنه', 'hummus', 'mezze']],
    ['breakfast', ['فول', 'عدس', 'شكشوكه', 'بيض', 'فطور', 'افطار', 'كشري', 'مطبق', 'معصوب', 'عريكه', 'فطائر', 'breakfast', 'egg', 'ful']],
    ['bread', ['خبز', 'صمون', 'توست', 'bread']],
];

/** قواعد الفئة — تُستخدم بعد الاسم. */
const CATEGORY_RULES = [
    ['coffee', ['كوفي', 'coffee']],
    ['juice', ['عصير', 'juice']],
    ['dessert', ['حلويات', 'حلا']],
    ['shawarma', ['شاورما', 'عرايسي']],
    ['buffet', ['بوفيه', 'بوفية']],
    ['breakfast', ['افطار', 'فطور']],
    ['salad', ['خضار', 'سلطات']],
    ['kabsa-chicken', ['الدجاج', 'رمضان', 'غداء', 'وصفة']],
    ['indonesian', ['ماليزي', 'اندونيسي', 'foods', 'drinks']],
    ['kebab', ['ساخن']],
];

/* الكلمات تُطبَّع مثل الاسم حتى لا تفشل المطابقة بسبب الهمزات أو التاء المربوطة. */
const NAME_RULES_NORM = NAME_RULES.map(([family, words]) => [family, words.map(normalize)]);
const CATEGORY_RULES_NORM = CATEGORY_RULES.map(([family, words]) => [family, words.map(normalize)]);

const DEFAULT_FAMILIES = ['kabsa-chicken', 'mixed-grill', 'shawarma', 'sandwich', 'salad'];

function pickFamily(row) {
    // الاسم العربي أولًا (أدق للمنيو المحلي)، ثم الإنجليزي، ثم الفئة، ثم بديل ثابت.
    for (const haystack of [normalize(row.name_ar), normalize(row.name_en)]) {
        if (!haystack) continue;
        for (const [family, words] of NAME_RULES_NORM) {
            if (words.some((word) => haystack.includes(word))) return family;
        }
    }
    const category = normalize(row.category);
    for (const [family, words] of CATEGORY_RULES_NORM) {
        if (words.some((word) => category.includes(word))) return family;
    }
    let hash = 0;
    for (const char of String(row.id)) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
    return DEFAULT_FAMILIES[hash % DEFAULT_FAMILIES.length];
}

async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const dbArg = args.find((arg) => arg.startsWith('--db='));
    const env = readEnv();
    const database = dbArg ? dbArg.slice(5) : env.DB_NAME || 'karim_erp';

    const client = new Client({
        host: env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT || 5432),
        database,
        user: env.DB_USER || 'postgres',
        password: env.DB_PASSWORD || '',
    });
    await client.connect();

    const rows = (
        await client.query(
            `SELECT id, name_ar, COALESCE(name_en, '') AS name_en, COALESCE(category, '') AS category, image_url
               FROM pos_products
              WHERE is_active = TRUE
              ORDER BY id`,
        )
    ).rows;

    const counts = new Map();
    const updates = [];
    const missingFiles = new Set();
    for (const row of rows) {
        if (String(row.image_url ?? '').startsWith('/uploads/menu/product-')) {
            counts.set('(صورة مرفوعة يدويًا)', (counts.get('(صورة مرفوعة يدويًا)') ?? 0) + 1);
            continue;
        }
        const family = pickFamily(row);
        const file = `pos-${family}.webp`;
        if (!fs.existsSync(path.join(MEDIA_DIR, file))) missingFiles.add(file);
        counts.set(family, (counts.get(family) ?? 0) + 1);
        const url = `${URL_PREFIX}${file}`;
        if (row.image_url !== url) updates.push({ id: row.id, url });
    }

    if (missingFiles.size) {
        console.error('ملفات صور مفقودة:', [...missingFiles].join(', '));
    }

    console.log(`قاعدة البيانات: ${database}`);
    console.log(`أصناف نشطة: ${rows.length} — ستُحدَّث: ${updates.length}`);
    console.log(
        [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([family, count]) => `  ${String(count).padStart(4)}  ${family}`)
            .join('\n'),
    );

    if (args.includes('--list')) {
        for (const row of rows) console.log(`${String(row.id).padStart(6)}  ${pickFamily(row).padEnd(16)} ${row.name_ar}`);
    }

    if (dry) {
        console.log('وضع المعاينة فقط — لم يُكتب شيء. أزل --dry للتطبيق.');
        await client.end();
        return;
    }

    await client.query('BEGIN');
    for (const update of updates) {
        await client.query('UPDATE pos_products SET image_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [
            update.id,
            update.url,
        ]);
    }
    await client.query('COMMIT');
    const verify = await client.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS with_image
           FROM pos_products WHERE is_active = TRUE`,
    );
    console.log('التحقق:', verify.rows[0]);
    await client.end();
}

main().catch((error) => {
    console.error('FAILED:', error.message);
    process.exit(1);
});
