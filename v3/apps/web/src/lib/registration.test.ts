import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { V3_SCREENS } from "./screens";

/**
 * حرّاس التسجيل — يمنعون انحراف القوائم الأربع التي يجب أن تبقى متطابقة:
 * `screens.ts` (المفاتيح) ↔ `routes.tsx` (المسارات + وحدات lazy) ↔
 * `Shell.tsx` (التنقّل) ↔ ملفات الشاشات واختباراتها.
 *
 * سبب وجودها: الجولة السابقة بُنيت على «55 شاشة» بينما الواقع 54، لأن
 * الأرقام كانت تُدار يدويًا. هذا الملف يجعل الانحراف يفشل في CI.
 */

/** جذر الحزمة — نبحث عنه من cwd صعودًا لأن vitest قد يعمل من الجذر. */
function findWebRoot(start: string): string {
	let current = start;
	for (let depth = 0; depth < 5; depth += 1) {
		if (existsSync(join(current, "src", "screens"))) {
			return current;
		}
		current = dirname(current);
	}
	throw new Error("لم أجد جذر apps/web من cwd");
}

const WEB_ROOT = findWebRoot(process.cwd());
const SCREENS_DIR = join(WEB_ROOT, "src", "screens");
const read = (path: string) => readFileSync(path, "utf8");

const routesText = read(join(WEB_ROOT, "src", "routes", "routes.tsx"));
const shellText = read(join(WEB_ROOT, "src", "components", "Shell.tsx"));

/**
 * المسارات/الوحدات الخدمية خارج مصفوفة التكافؤ (Home على `/` و/design).
 * تُستثنى من حرّاس «57/60 شاشة» لأنها ليست شاشات v2 ولا تدخل التنقّل.
 * لا تُضاف إلى V3_SCREENS، ولا تُحتسب في توقّعات هذه الملف.
 */
const UTILITY_ROUTE_KEYS = new Set(["design"]);
const UTILITY_LAZY_MODULES = new Set(["Home", "DesignGallery"]);

const routeKeys = [...routesText.matchAll(/path: ["']\/([a-z0-9-]+)["']/g)]
	.map((match) => match[1] ?? "")
	.filter((key) => !UTILITY_ROUTE_KEYS.has(key));
const lazyModules = [
	...routesText.matchAll(
		/import\(["']\.\.\/screens\/([A-Za-z0-9]+)\.lazy["']\)/g,
	),
]
	.map((match) => match[1] ?? "")
	.filter((moduleName) => !UTILITY_LAZY_MODULES.has(moduleName));

const navBlock =
	shellText.split("const NAV_ITEMS = [")[1]?.split("] as const;")[0] ?? "";
const navKeys = [...navBlock.matchAll(/to: ["']\/([a-z0-9-]+)["']/g)].map(
	(match) => match[1] ?? "",
);

function lazyModule(moduleName: string) {
	const path = join(SCREENS_DIR, `${moduleName}.lazy.tsx`);
	if (!existsSync(path)) {
		return { exists: false, gate: null, impl: null };
	}
	const text = read(path);
	return {
		exists: true,
		gate: /screen="([a-z0-9-]+)"/.exec(text)?.[1] ?? null,
		impl: /from ["']\.\/([A-Za-z0-9]+)["']/.exec(text)?.[1] ?? null,
	};
}

describe("حرّاس تسجيل الشاشات", () => {
	it("المفاتيح فريدة", () => {
		expect(new Set(V3_SCREENS).size).toBe(V3_SCREENS.length);
	});

	it("المسارات تطابق المفاتيح بالضبط", () => {
		expect(routeKeys).toHaveLength(V3_SCREENS.length);
		expect([...routeKeys].sort()).toEqual([...V3_SCREENS].sort());
	});

	it("كل مسار له وحدة lazy بوسم مطابق ووحدة تنفيذ واختبار", () => {
		expect(lazyModules).toHaveLength(routeKeys.length);

		const failures: string[] = [];
		routeKeys.forEach((key, index) => {
			const moduleName = lazyModules[index] ?? "";
			const meta = moduleName
				? lazyModule(moduleName)
				: { exists: false, gate: null, impl: null };
			if (!meta.exists) {
				failures.push(`${key}: ${moduleName || "(بلا وحدة)"}.lazy.tsx مفقود`);
				return;
			}
			if (meta.gate !== key) {
				failures.push(`${key}: وسم ScreenGate هو ${meta.gate ?? "غائب"}`);
			}
			if (!meta.impl || !existsSync(join(SCREENS_DIR, `${meta.impl}.tsx`))) {
				failures.push(`${key}: وحدة التنفيذ ${meta.impl ?? "غائبة"} مفقودة`);
				return;
			}
			if (!existsSync(join(SCREENS_DIR, `${meta.impl}.test.tsx`))) {
				failures.push(`${key}: لا اختبار لوحدة ${meta.impl}`);
			}
		});

		expect(failures).toEqual([]);
	});

	it("التنقّل يساوي المفاتيح بلا زيادة أو تكرار", () => {
		expect(navKeys).toHaveLength(V3_SCREENS.length);
		expect(new Set(navKeys).size).toBe(navKeys.length);
		expect([...navKeys].sort()).toEqual([...V3_SCREENS].sort());
	});
});
