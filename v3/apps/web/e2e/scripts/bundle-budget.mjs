import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * بوابة ميزانية الحزمة — تحمي سرعة الإقلاع من التضخّم الصامت.
 *
 * تقيس `dist` كما يستلمه المتصفح: gzip لكل ملف، والدخول من `index.html`
 * نفسه لا من تخمين. الفشل يعني حزمة أثقل من حدود `e2e/budget.json`.
 */

const WEB = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = join(WEB, "dist");
const ASSETS = join(DIST, "assets");
const BUDGET = JSON.parse(
	readFileSync(join(WEB, "e2e", "budget.json"), "utf8"),
);

const kib = (bytes) => Math.round((bytes / 1024) * 10) / 10;

function gzipSize(file) {
	return gzipSync(readFileSync(file), { level: 9 }).length;
}

const indexHtml = readFileSync(join(DIST, "index.html"), "utf8");
const entryJs = /src="([^"]+\/assets\/index-[^"]+\.js)"/.exec(indexHtml)?.[1];
const entryCss = /href="([^"]+\/assets\/index-[^"]+\.css)"/.exec(
	indexHtml,
)?.[1];
if (!entryJs || !entryCss) {
	console.error("تعذّر قراءة نقطة الدخول من dist/index.html — هل البناء مكتمل؟");
	process.exit(1);
}

const toFile = (url) => join(DIST, url.replace(/^\/v3\//, ""));

const assets = readdirSync(ASSETS)
	.filter((name) => /\.(js|css)$/.test(name))
	.map((name) => {
		const bytes = gzipSize(join(ASSETS, name));
		return { name, bytes };
	});

let totalJs = 0;
let totalCss = 0;
for (const asset of assets) {
	if (asset.name.endsWith(".js")) totalJs += asset.bytes;
	else totalCss += asset.bytes;
}
const largest = assets.reduce(
	(max, asset) => (asset.bytes > max.bytes ? asset : max),
	{
		name: "",
		bytes: 0,
	},
);

const measured = {
	entryJs: gzipSize(toFile(entryJs)),
	totalJs,
	totalCss,
	maxChunk: largest.bytes,
};

const rows = [
	["entryJs", measured.entryJs, BUDGET.entryJs, entryJs.split("/").pop()],
	[
		"totalJs",
		measured.totalJs,
		BUDGET.totalJs,
		`${assets.filter((a) => a.name.endsWith(".js")).length} ملف`,
	],
	[
		"totalCss",
		measured.totalCss,
		BUDGET.totalCss,
		`${assets.filter((a) => a.name.endsWith(".css")).length} ملف`,
	],
	["maxChunk", measured.maxChunk, BUDGET.maxChunk, largest.name],
];

let failed = false;
console.log("الميزانية (gzip KiB):");
for (const [key, value, limit, note] of rows) {
	const over = kib(value) > limit;
	failed ||= over;
	const mark = over ? "✗" : "✓";
	console.log(
		`  ${mark} ${key.padEnd(9)} ${String(kib(value)).padStart(7)} / ${String(limit).padStart(5)}  ${note}`,
	);
}

const top = [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
console.log("أثقل خمس حزم:");
for (const asset of top) {
	console.log(`  · ${String(kib(asset.bytes)).padStart(7)} KiB  ${asset.name}`);
}

if (failed) {
	console.error(
		"\nتجاوزت الحزمة ميزانيتها — أخفِّف أو ارفع الحد في e2e/budget.json مع مبرّر.",
	);
	process.exit(1);
}
console.log("\nداخل الميزانية.");
