/**
 * buffet-name-en.mjs — الأسماء الإنجليزية لكل الأصناف (91 صنفًا) للكرت ثنائي اللغة.
 * idempotent: UPDATE بالمعرف فقط — يتطلب `157_buffet_name_en.sql`.
 * الاستخدام: node scripts/buffet-name-en.mjs [--dry-run]
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync('.env', 'utf8').split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const DRY = process.argv.includes('--dry-run');

/* [id, الاسم العربي للتحقق, name_en] */
const DISHES = [
    [1, 'شوربة بصل', 'French Onion Soup'],
    [2, 'شوربة خضار كلير', 'Clear Vegetable Soup'],
    [3, 'شوربة شعرية', 'Vermicelli Soup'],
    [4, 'شوربة عدس', 'Lentil Soup'],
    [5, 'شوربة لسان عصفور', 'Orzo Soup'],
    [6, 'شوربة بروكلي', 'Broccoli Soup'],
    [7, 'شوربة بطاطس', 'Potato Soup'],
    [8, 'شوربة جزر', 'Carrot Soup'],
    [9, 'شوربة حمص باللحم', 'Chickpea & Beef Soup'],
    [10, 'شوربة خضار كريمه', 'Cream of Vegetable Soup'],
    [11, 'شوربة ذرة حلوة', 'Sweet Corn Soup'],
    [12, 'شوربة سي فود', 'Seafood Soup'],
    [13, 'شوربة كريمة دجاج', 'Cream of Chicken Soup'],
    [14, 'شوربة مشروم', 'Mushroom Soup'],
    [15, 'أرز بخاري باللحم', 'Bukhari Rice with Lamb'],
    [16, 'أرز زربيان باللحم', 'Zurbian Rice with Lamb'],
    [17, 'أرز مندي باللحم', 'Mandi Rice with Lamb'],
    [18, 'كابلي اللحم', 'Kabuli Rice with Lamb'],
    [19, 'كبسة لحم', 'Kabsa with Lamb'],
    [20, 'مسلوسة اللحم', 'Yemeni Musalu-sa with Lamb'],
    [21, 'مضغوط اللحم', 'Maghdoud Rice with Lamb'],
    [22, 'مقلوبة لحم أرز', 'Maqluba with Lamb'],
    [23, 'أرز بخاري', 'Bukhari Rice'],
    [24, 'أرز بشاور', 'Peshawari Rice'],
    [25, 'أرز زربيان', 'Zurbian Rice'],
    [26, 'أرز صياديه', 'Sayadeya Rice'],
    [27, 'أرز كابلي', 'Kabuli Rice'],
    [28, 'أرز كبسة', 'Kabsa Rice'],
    [29, 'أرز مدني', 'Madani Rice'],
    [30, 'أرز مصري بالشعرية', 'Egyptian Rice with Vermicelli'],
    [31, 'أرز معمر', "Me'ammar Rice"],
    [32, 'أرز مكسيكي', 'Mexican Rice'],
    [33, 'دجاج اتشاري', 'Achaari Chicken'],
    [34, 'دجاج بانيه', 'Chicken Schnitzel'],
    [35, 'دجاج تندوري', 'Tandoori Chicken'],
    [36, 'دجاج رستو', 'Roast Chicken'],
    [37, 'دجاج روزماري وزبدة', 'Rosemary Butter Chicken'],
    [38, 'دجاج كاري', 'Chicken Curry'],
    [39, 'دجاج كورما', 'Chicken Korma'],
    [40, 'مكرونة إسباجتي', 'Spaghetti'],
    [41, 'مكرونة بشاميل', 'Bechamel Pasta'],
    [42, 'مكرونة بلونيز', 'Bolognese Pasta'],
    [43, 'مكرونة بينا أربياتا', 'Penne Arrabbiata'],
    [44, 'مكرونة فتوتشيني', 'Fettuccine'],
    [45, 'مكرونة نودليز', 'Asian Noodles'],
    [46, 'بامية باللحم', 'Okra with Beef'],
    [47, 'جريش', 'Jareesh'],
    [48, 'قرصان', 'Quraisan'],
    [49, 'كسكسي مغربي', 'Moroccan Couscous'],
    [50, 'كشري مصري', 'Egyptian Koshari'],
    [51, 'ملوخية', 'Molokhia'],
    [52, 'بطاطس بالأعشاب', 'Herb Potatoes'],
    [53, 'بطاطس حار', 'Spicy Potatoes'],
    [54, 'بطاطس كاريه', 'Potato Cubes'],
    [55, 'بطاطس ليونيز', 'Potatoes Lyonnaise'],
    [56, 'بطاطس ويدجز', 'Potato Wedges'],
    [57, 'طاجن بطاطس بالدجاج', 'Baked Potato & Chicken Casserole'],
    [58, 'جولاش خضار', 'Vegetable Strudel'],
    [59, 'خضار سوتيه', 'Sautéed Vegetables'],
    [60, 'خضار مشكل', 'Mixed Vegetables'],
    [61, 'مقلوبة خضار', 'Vegetable Maqluba'],
    [62, 'جولاش لحم', 'Meat Strudel'],
    [63, 'خضار راتاتوي', 'Ratatouille'],
    [64, 'داود باشا', 'Dawood Basha Meatballs'],
    [65, 'كفتة أرز', 'Rice Kofta'],
    [66, 'ريزوتو بالفطر', 'Wild Mushroom Risotto'],
    [67, 'لازانيا باللحم', 'Beef Lasagna'],
    [68, 'سباغيتي كاربونارا', 'Spaghetti Carbonara'],
    [69, 'فيتوتشيني ألفريدو', 'Fettuccine Alfredo'],
    [70, 'برياني دجاج', 'Chicken Biryani'],
    [71, 'دجاج تيرياكي', 'Teriyaki Chicken'],
    [72, 'نودلز سي فود', 'Seafood Noodles'],
    [73, 'سالمون تيرياكي', 'Teriyaki Salmon'],
    [74, 'جمبري بالثوم والزبدة', 'Garlic Butter Shrimp'],
    [75, 'دجاج كونغ باو', 'Kung Pao Chicken'],
    [76, 'كاري دجاج بجوز الهند', 'Coconut Chicken Curry'],
    [77, 'روبيان ماسالا', 'Shrimp Masala'],
    [78, 'مسخن دجاج', 'Musakhan'],
    [79, 'مجدرة', 'Mujaddara'],
    [80, 'محشي ورق عنب', 'Stuffed Vine Leaves'],
    [81, 'إسكندر كباب', 'Iskender Kebab'],
    [82, 'مانتي تركي', 'Turkish Manti'],
    [83, 'كباب أضنة', 'Adana Kebab'],
    [84, 'فاهيتا دجاج', 'Chicken Fajitas'],
    [85, 'تشيلي كون كارني', 'Chili con Carne'],
    [86, 'ستيك بالفلفل الأسود', 'Black Pepper Steak'],
    [87, 'كيش السبانخ والجبن', 'Spinach & Cheese Quiche'],
    [88, 'باييلا بالدجاج والزعفران', 'Chicken Paella'],
    [89, 'دجاج باربكيو مدخن', 'Smoked BBQ Chicken'],
    [90, 'ريش بتلو باربكيو', 'BBQ Veal Chops'],
    [91, 'سوفلاكي دجاج', 'Chicken Souvlaki'],
];

const pool = new Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
});

(async () => {
    const client = await pool.connect();
    try {
        const expected = await client.query('SELECT count(*)::int AS n FROM buffet_dishes');
        console.log('dishes in db:', expected.rows[0].n, '| entries:', DISHES.length);
        if (DRY) {
            for (const [id, name] of DISHES) console.log(`${id}\t${name}`);
            return;
        }
        await client.query('BEGIN');
        for (const [id, name, en] of DISHES) {
            const r = await client.query(
                'UPDATE buffet_dishes SET name_en = $1, updated_at = now() WHERE id = $2 AND name = $3',
                [en, id, name],
            );
            if (r.rowCount !== 1) {
                throw new Error(`row mismatch at id=${id} (${name}) — rowCount=${r.rowCount}`);
            }
        }
        await client.query('COMMIT');
        const verify = await client.query(
            `SELECT count(*) FILTER (WHERE name_en IS NULL OR btrim(name_en) = '') AS no_en FROM buffet_dishes`,
        );
        console.log('verify (must be 0):', verify.rows[0].no_en);
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('ROLLBACK:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
