/**
 * buffet-descriptions.mjs — أوصاف الأصناف بالعربية + الإنجليزية (ثنائي اللغة).
 * يجمع بطاقة الصنف: الوصف العربي (خط التحضير) والسطر الإنجليزي (للمطبخ/الضيوف الأجانب).
 * idempotent: UPDATE بالمعرف فقط؛ آمن يعاد تشغيله. يتطلب `156_buffet_description_en.sql`.
 *
 * الاستخدام: node scripts/buffet-descriptions.mjs [--dry-run]
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
    readFileSync('.env', 'utf8').split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const DRY = process.argv.includes('--dry-run');

/* [id, الاسم المرجعي للتحقق, الوصف العربية, description_en] */
const DISHES = [
    [1, 'شوربة بصل', 'بصل مكرمل ببطء في الزبدة مع مرقة مركزة وكريمة وعصير ليمون', 'Slow-caramelised onion soup finished with rich stock, cream and lemon'],
    [2, 'شوربة خضار كلير', 'مرقة خضار صافية بجزر وكرفس وبقدونس — خفيفة وخالية من الدهون', 'Clear vegetable broth with carrot, celery and parsley — light and fat-free'],
    [3, 'شوربة شعرية', 'شعرية محمّرة في الزيت مع مرقة دجاج صافية وخضار وعصير ليمون', 'Toasted vermicelli in clear chicken broth with vegetables and lemon'],
    [4, 'شوربة عدس', 'عدس أصفر مطبوخ مع جزر وبصل وثوم وكمون وليمون', 'Yellow lentil soup with carrot, onion, garlic, cumin and lemon'],
    [5, 'شوربة لسان عصفور', 'لسان عصفور في مرقة دجاج صافية مع خضار وعصير ليمون', 'Orzo in clear chicken broth with vegetables and lemon'],
    [6, 'شوربة بروكلي', 'بروكلي طازج مع كريمة ومكعبات بطاطس وتوابل خفيفة', 'Fresh broccoli blended with cream, potato and mild spices'],
    [7, 'شوربة بطاطس', 'بطاطس كريمي مع قشدة وثوم وإكليل جبل', 'Creamy potato soup with cream, garlic and rosemary'],
    [8, 'شوربة جزر', 'جزر طازج مع زنجبيل وتفاح وكريمة وجوزة الطيب', 'Carrot and ginger soup with apple, cream and nutmeg'],
    [9, 'شوربة حمص باللحم', 'حمص حب مع لحم بقري طري وكزبرة وكمون وليمون', 'Chickpeas with tender beef, coriander, cumin and lemon'],
    [10, 'شوربة خضار كريمه', 'تشكيلة خضار بالكريمة والتوابل مع زيت زيتون', 'Mixed garden vegetables blended with cream and olive oil'],
    [11, 'شوربة ذرة حلوة', 'ذرة حلوة كريمي بالزبدة والقشدة والثوم', 'Sweet corn blended with butter, cream and garlic'],
    [12, 'شوربة سي فود', 'تشكيلة ثمار بحر في مرقة كزبرة وثوم وليمون', 'Seafood medley in a coriander, garlic and lemon broth'],
    [13, 'شوربة كريمة دجاج', 'دجاج مسلوق بالكريمة ونكهة جوزة الطيب', 'Poached chicken blended with cream and nutmeg'],
    [14, 'شوربة مشروم', 'مشروم بري بالكريمة والثوم وإكليل جبل', 'Wild mushroom soup with cream, garlic and rosemary'],
    [15, 'أرز بخاري باللحم', 'أرز بسمتي ببهارات بخاري مع لحم مطبوخ ولوز وزبيب', 'Bukhari pulao — spiced basmati with lamb, almonds and raisins'],
    [16, 'أرز زربيان باللحم', 'أرز زربيان عدني طبقات مع لحم وبهارات وهيل وزعفران', 'Adeni zurbian — layered saffron rice with spiced lamb'],
    [17, 'أرز مندي باللحم', 'مندي — أرز مدخن مع لحم طري مطبوخ ببطء', 'Mandi — slow-cooked tender lamb over smoked basmati rice'],
    [18, 'كابلي اللحم', 'أرز كابولي مع لحم ضأن وجزر وزبيب وزعفران', 'Kabuli pulao with lamb, carrots, raisins and saffron'],
    [19, 'كبسة لحم', 'أرز بسمتي مع لحم ومزيج توابل الكبسة وهيل وليمون', 'Kabsa rice with lamb and signature spice blend, cardamom and lemon'],
    [20, 'مسلوسة اللحم', 'أرز على الطريقة اليمنية مع لحم ضأن مطبوخ ببطء وبهارات مسلوسة', 'Yemeni-style slow-cooked rice with lamb and signature spices'],
    [21, 'مضغوط اللحم', 'أرز مضغوط مطبوخ تحت الضغط مع لحم وبهارات مضغوط الخاصة', 'Maghdoud — pressure-cooked rice with lamb and signature spices'],
    [22, 'مقلوبة لحم أرز', 'مقلوبة — أرز مع لحم وخضروات مقلية تُقلب عند التقديم', 'Maqluba — layered rice, meat and fried vegetables flipped to serve'],
    [23, 'أرز بخاري', 'أرز بسمتي ببهارات بخاري وزيت وسمن', 'Bukhari rice — spiced basmati simmered with ghee and stock'],
    [24, 'أرز بشاور', 'أرز بشاور المتبل بفلفل وتوابل باكستانية وبهارات حارقة', 'Peshawari spicy basmati with bold Pakistani aromatics'],
    [25, 'أرز زربيان', 'أرز زربيان بزعفران وهيل على الطريقة العدنية', 'Zurbian rice — saffron and cardamom rice, Adeni-style'],
    [26, 'أرز صياديه', 'أرز الصيادية على الطريقة الساحلية مع سمك وبهارات وبصل محمّر', 'Coastal Sayadeya rice with fish, caramelised onion and spices'],
    [27, 'أرز كابلي', 'أرز كابولي زعفراني بالزبيب والجزر على الطريقة الأفغانية', 'Kabuli pulao — saffron rice with raisins and carrots, Afghan-style'],
    [28, 'أرز كبسة', 'أرز بسمتي ببهارات الكبسة وهيل وعصير ليمون', 'Kabsa rice — basmati with kabsa spices, cardamom and lemon'],
    [29, 'أرز مدني', 'أرز مدني — أرز بسمتي بالكمون والهيل على الطريقة المدنية', 'Madani rice — basmati with cumin and cardamom, Madinah-style'],
    [30, 'أرز مصري بالشعرية', 'أرز مصري بحبة قصيرة مع شعرية محمّرة بالزيت', 'Short-grain Egyptian rice with toasted vermicelli'],
    [31, 'أرز معمر', 'أرز معمر — أرز مخبوز في اللبن والقشطة بالفرن', "Me'ammar — rice baked in the oven with milk and cream"],
    [32, 'أرز مكسيكي', 'أرز مكسيكي — أرز بالطماطم والفلفل والكزبرة والتوابل', 'Mexican rice — cooked with tomato, pepper, cilantro and spices'],
    [33, 'دجاج اتشاري', 'دجاج مخلل ببهارات أچار الهندي مع ليمون وثوم وزيت', 'Achaari chicken — chicken in Indian pickle spices with lemon and garlic'],
    [34, 'دجاج بانيه', 'دجاج بانيه — صدور دجاج بفتات الخبز الذهبي مقلية', 'Chicken schnitzel — breaded fried chicken breast, golden crust'],
    [35, 'دجاج تندوري', 'دجاج تندوري — دجاج متبل بالزبادي والبهارات ومشوي في التندور', 'Tandoori chicken — yogurt-marinated chicken grilled in a tandoor'],
    [36, 'دجاج رستو', 'دجاج رستو — دجاجة كاملة محمّرة بزبدة وأعشاب وثوم', 'Roast chicken — whole chicken roasted with butter, herbs and garlic'],
    [37, 'دجاج روزماري وزبدة', 'صدور دجاج بزبدة وإكليل جبل وعصير ليمون', 'Rosemary butter chicken — chicken breast with butter, rosemary and lemon'],
    [38, 'دجاج كاري', 'دجاج بصلصة كاري حريرة بالكزبرة والكمون', 'Chicken curry — chicken in warm spiced curry sauce with coriander'],
    [39, 'دجاج كورما', 'دجاج كورما — دجاج كريمي بالزبادي والمكسرات والتوابل', 'Chicken korma — creamy chicken with yogurt, nuts and mild spices'],
    [40, 'مكرونة إسباجتي', 'مكرونة إسباجتي بصلصة طماطم وأعشاب وزيت زيتون', 'Spaghetti — long pasta tossed in tomato and herb sauce'],
    [41, 'مكرونة بشاميل', 'مكرونة بشاميل — مكرونة بصلصة بشاميل ولحم مفروم مشوي وجبن', 'Bechamel pasta — pasta with bechamel, minced meat and cheese'],
    [42, 'مكرونة بلونيز', 'مكرونة بلونيز — مكرونة بصلصة بلونيز لحم طماطم', 'Bolognese pasta — pasta with minced-beef tomato ragu'],
    [43, 'مكرونة بينا أربياتا', 'مكرونة بينا أربياتا — مكرونة أقلام بصلصة طماطم حارة وثوم', 'Penne arrabbiata — penne in spicy garlic tomato sauce'],
    [44, 'مكرونة فتوتشيني', 'مكرونة فتوتشيني — شرائط مكرونة بصلصة كريمة وبارميزان', 'Fettuccine — ribbon pasta in cream and parmesan sauce'],
    [45, 'مكرونة نودليز', 'نودلز آسيوية مطبوخة مع خضار وصلصة الصويا والزنجبيل', 'Asian noodles — stir-fried noodles with vegetables, soy and ginger'],
    [46, 'بامية باللحم', 'بامية خضراء مطبوخة بلحم بقري وصلصة طماطم بالثوم', 'Okra with beef — okra simmered with beef and garlic tomato sauce'],
    [47, 'جريش', 'جريش — قمح مجروش مطبوخ باللبن وبصل محمّر وسمن بلدي', 'Jareesh — crushed wheat cooked with yogurt, caramelised onion and ghee'],
    [48, 'قرصان', 'قرصان يمني — خبز قرصان مشرب بمرقة لحم ببهارات خاصة', 'Quraisan — Yemeni bread soaked in spiced meat broth'],
    [49, 'كسكسي مغربي', 'كسكسي مغربي — سميد مبخر مع خضار ولحم وتوابل رأس الحانوت', 'Moroccan couscous — steamed semolina with vegetables, meat and ras-el-hanout'],
    [50, 'كشري مصري', 'كشري مصري — أرز وعدس وشعرية ومكرونة وصلصة طماطم حرّيفة وبصل', 'Egyptian koshari — rice, lentils, vermicelli and pasta with spicy tomato and fried onion'],
    [51, 'ملوخية', 'ملوخية — ملوخية خضراء بمرقة دجاج وثوم وكزبرة جافة', 'Molokhia — Egyptian molokhia leaves in garlic-coriander chicken broth'],
    [52, 'بطاطس بالأعشاب', 'بطاطس محمرّة بزيت وأعشاب طازجة وزعتر', 'Herb potatoes — pan-roasted potatoes with fresh herbs and thyme'],
    [53, 'بطاطس حار', 'بطاطس حارة بالفلفل الأحمر المجفف والثوم والبهارات', 'Spicy potatoes — potatoes with dried red chilli, garlic and spices'],
    [54, 'بطاطس كاريه', 'بطاطس كاريه — مكعبات بطاطس مقلية مقرمشة', 'Potato cubes — crispy golden fried potato chunks'],
    [55, 'بطاطس ليونيز', 'بطاطس ليونيز — بطاطس سوتيه بالزبدة مع بصل محمّر على الطريقة الفرنسية', 'Potatoes lyonnaise — sautéed potatoes with caramelised onion and butter, French-style'],
    [56, 'بطاطس ويدجز', 'بطاطس ويدجز — ويدجز بطاطس مخبوزة بالأعشاب والفلفل الأسود', 'Potato wedges — baked seasoned wedges with herbs and black pepper'],
    [57, 'طاجن بطاطس بالدجاج', 'طاجن فرن — بطاطس ودجاج متبل مع جبن ذائب وطماطم', 'Baked potato-chicken casserole with cheese, tomato and herbs'],
    [58, 'جولاش خضار', 'جولاش خضار — عجينة جولاش مقرمشة محشوة خضار وأعشاب', 'Vegetable strudel — flaky filo bake with garden vegetables and herbs'],
    [59, 'خضار سوتيه', 'خضار سوتيه — خضار طازجة سوتيه بثوم وزيت زيتون', 'Sautéed vegetables — fresh seasonal vegetables with garlic and olive oil'],
    [60, 'خضار مشكل', 'خضار مشكل — مزيج خضار مشوي على البخار متبلة بالأعشاب', 'Mixed vegetables — steamed seasonal medley, herb-seasoned'],
    [61, 'مقلوبة خضار', 'مقلوبة خضار — أرز مع خضروات مقلية تُقلب عند التقديم', 'Vegetable maqluba — layered rice and fried vegetables flipped to serve'],
    [62, 'جولاش لحم', 'جولاش لحم — عجينة جولاش مقرمشة محشوة لحم متبل', 'Meat strudel — flaky filo bake with spiced minced meat'],
    [63, 'خضار راتاتوي', 'راتاتوي — شرائح باذنجان وكوسة وفلفل وطماطم بصلصة طماطم وأعشاب فرنسية', 'Ratatouille — layered roasted eggplant, zucchini and peppers in tomato-herb sauce'],
    [64, 'داود باشا', 'كرات لحم متبلة بصلصة طماطم وبهارات وتوابل الكفتة', 'Dawood Basha — spiced meatballs in tomato and onion sauce'],
    [65, 'كفتة أرز', 'كفتة أرز — كرات أرز ولحم مفروم بصلصة طماطم بالثوم', 'Rice kofta — rice and minced-meat balls in garlic tomato sauce'],
    /* ─── الأصناف العالمية (66–91) ─── */
    [66, 'ريزوتو بالفطر', 'ريزوتو كريمي بأرز أربوريو مع فطر بري وزبدة وبارميزان وليمون', 'Wild mushroom risotto — creamy arborio with mushrooms, butter, lemon and parmesan'],
    [67, 'لازانيا باللحم', 'لازانيا — طبقات عجين مع لحم مفروم وصلصة طماطم وبشاميل وموتزاريلا', 'Beef lasagna — layers of pasta with minced beef, tomato sauce, bechamel and mozzarella'],
    [68, 'سباغيتي كاربونارا', 'سباغيتي كاربونارا — سباغيتي بصلصة كريمة وجبن بيكورينو ولحم مدخن', 'Spaghetti carbonara — pasta with creamy pecorino sauce and cured beef'],
    [69, 'فيتوتشيني ألفريدو', 'فيتوتشيني ألفريدو — شرائط فيتوتشيني بصلصة زبدة وكريمة وبارميزان وجوزة الطيب', 'Fettuccine Alfredo — ribbon pasta in butter, cream, parmesan and nutmeg'],
    [70, 'برياني دجاج', 'برياني دجاج — أرز بسمتي مع دجاج متبل ببهارات برياني وهيل وزعفران', 'Chicken biryani — basmati layered with spiced chicken, cardamom and saffron'],
    [71, 'دجاج تيرياكي', 'دجاج تيرياكي — دجاج بصوص الصويا والزنجبيل والعسل والسمسم', 'Teriyaki chicken — chicken glazed with soy, ginger, honey and sesame'],
    [72, 'نودلز سي فود', 'نودلز سي فود — نودلز بجمبري وكاليماري وخضار بصلصة الترياكي', 'Seafood noodles — stir-fried noodles with shrimp, calamari and vegetables in teriyaki'],
    [73, 'سالمون تيرياكي', 'سالمون تيرياكي — شرائح سالمون بصوص الترياكي والسمسم والبصل الأخضر', 'Teriyaki salmon — salmon fillets glazed with teriyaki, sesame and spring onion'],
    [74, 'جمبري بالثوم والزبدة', 'جمبري بالثوم والزبدة — جمبري سوتيه بثوم وزبدة وبقدونس وليمون', 'Garlic-butter shrimp — sautéed shrimp with garlic, butter, parsley and lemon'],
    [75, 'دجاج كونغ باو', 'دجاج كونغ باو — دجاج سيتشوان بالفول السوداني والفلفل الحار والخضروات', 'Kung Pao chicken — Sichuan chicken with peanuts, chilli and vegetables'],
    [76, 'كاري دجاج بجوز الهند', 'كاري دجاج بجوز الهند — دجاج بصلصة كاري جوز الهند مع كزبرة وهيل', 'Coconut chicken curry — chicken in coconut curry with coriander and cardamom'],
    [77, 'روبيان ماسالا', 'روبيان ماسالا — روبيان بتوابل تندوري بصوص الطماطم المتبلة', 'Shrimp masala — shrimp in tandoor spices with spiced tomato sauce'],
    [78, 'مسخن دجاج', 'مسخن — دجاج بالسماق والبصل على خبز شراك بزيت زيتون وليمون', 'Musakhan — chicken with sumac and onions on taboon bread with olive oil'],
    [79, 'مجدرة', 'مجدرة — عدس بني وأرز بكمون وبصل محمّر مقرمش', 'Mujaddara — lentils and rice with cumin and crispy fried onion'],
    [80, 'محشي ورق عنب', 'محشي ورق عنب — ورق عنب محشو أرز ولحم مفروم ودبس رمان', 'Stuffed vine leaves — vine leaves filled with rice, minced meat and pomegranate molasses'],
    [81, 'إسكندر كباب', 'إسكندر كباب — لحم مشوي على خبز محمّص بصوص الطماطم واللبن والزبدة', 'Iskender kebab — grilled meat over toasted bread with tomato sauce, yogurt and butter'],
    [82, 'مانتي تركي', 'مانتي — حبات معكرونة محشوة لحم بصلصة اللبن والثوم والزبدة', 'Turkish manti — pasta parcels filled with meat in garlic-yogurt sauce with butter'],
    [83, 'كباب أضنة', 'كباب أضنة — كباب لحم متبل على الفحم مع البقدونس والبصل', 'Adana kebab — minced lamb kebab with parsley and onion, charcoal-grilled'],
    [84, 'فاهيتا دجاج', 'فاهيتا — شرائح دجاج وفلفل وبصل ببهارات الفاهيتا مع تورتيلا', 'Chicken fajitas — sliced chicken, peppers and onions with fajita spice, with tortillas'],
    [85, 'تشيلي كون كارني', 'تشيلي كون كارني — لحم بقري مفروم وفاصوليا حمراء وطماطم وفلفل حار', 'Chilli con carne — minced beef, red kidney beans, tomato and chilli'],
    [86, 'ستيك بالفلفل الأسود', 'ستيك بالفلفل الأسود — شرائح لحم متن بصلصة الكونياك والفلفل الأسود', 'Pepper steak — beef tenderloin in cognac and black pepper sauce'],
    [87, 'كيش السبانخ والجبن', 'كيش سبانخ وجبن — تارت كيش بالقشطة والبيض والسبانخ والجبن', 'Spinach and cheese quiche — egg-custard tart with spinach and cheese'],
    [88, 'باييلا بالدجاج والزعفران', 'باييلا — أرز زعفران مع دجاج وبازلاء وفاصوليا خضراء وفلفل ملون', 'Chicken paella — saffron rice with chicken, peas, green beans and peppers'],
    [89, 'دجاج باربكيو مدخن', 'دجاج باربكيو — أفخاذ دجاج بصوص باربكيو مدخن غني', 'Smoked BBQ chicken — chicken thighs in rich smoked barbecue sauce'],
    [90, 'ريش بتلو باربكيو', 'ريش بتلو — ريش بتلو بصوص باربكيو مدخن وبصل مكرمل', 'BBQ veal chops — veal ribs in smoked barbecue sauce with caramelised onion'],
    [91, 'سوفلاكي دجاج', 'سوفلاكي — أسياخ دجاج بالأوريجانو والليمون والثوم مشوية على الفحم', 'Souvlaki — chicken skewers with oregano, lemon and garlic, charcoal-grilled'],
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
        console.log('dishes in db:', expected.rows[0].n, '| entries to upsert:', DISHES.length);
        if (DISHES.length !== expected.rows[0].n) {
            console.warn('⚠ عدد القوائم لا يطابق عدد الأصناف — القوائم المتبقية لن تُمسّ');
        }
        if (DRY) {
            console.log('--dry-run — لا تعديل');
            for (const [id, name] of DISHES) console.log(`${id}\t${name}`);
            return;
        }
        await client.query('BEGIN');
        for (const [id, name, ar, en] of DISHES) {
            const r = await client.query(
                `UPDATE buffet_dishes SET description = $1, description_en = $2, updated_at = now()
                 WHERE id = $3 AND name = $4`,
                [ar, en, id, name],
            );
            if (r.rowCount !== 1) {
                throw new Error(`row mismatch at id=${id} (${name}) — rowCount=${r.rowCount}`);
            }
        }
        await client.query('COMMIT');
        const verify = await client.query(
            `SELECT count(*) FILTER (WHERE description IS NULL OR btrim(description) = '') AS no_ar,
                    count(*) FILTER (WHERE description_en IS NULL OR btrim(description_en) = '') AS no_en,
                    count(*) AS total FROM buffet_dishes`,
        );
        console.log('verify:', JSON.stringify(verify.rows[0]));
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('ROLLBACK:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
