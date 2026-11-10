import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, vi } from 'vitest';

/**
 * مساعدات اختبار مكوّنات `src/ui/`:
 *
 *  1. `installDomPolyfills()` — jsdom ينقصه ما تعتمد عليه بدائيات Radix
 *     (Pointer capture، scrollIntoView، ResizeObserver)؛ نُوفّره محليًا بدل
 *     تعديل `setupTests.ts` المشترك (ملك Lead).
 *  2. `loadAxe()` — axe-core ليس تبعية مباشرة للتطبيق (فقط عبر Playwright)،
 *     فنقرأ حِزمته من متجر pnpm ونُشغّلها في jsdom. إن غابت الحزمة على جهاز
 *     آخر يعود `null` وتُتخطّى الفحوص بدل إسقاط البوابة على البيئة.
 *  3. `mockMatchMedia()` — يسمح بمحاكاة `prefers-color-scheme` وتغييره.
 *  4. `clearTheme()` — تنظيف أثر الثيم على `documentElement` والتخزين.
 */

let polyfillsInstalled = false;

export function installDomPolyfills(): void {
    if (polyfillsInstalled) {
        return;
    }
    polyfillsInstalled = true;

    if (typeof globalThis.ResizeObserver === 'undefined') {
        class ResizeObserverMock {
            observe(): void {
                /* لا تخطيط في jsdom */
            }
            unobserve(): void {
                /* لا تخطيط في jsdom */
            }
            disconnect(): void {
                /* لا تخطيط في jsdom */
            }
        }
        globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    }

    if (typeof window === 'undefined') {
        return;
    }

    if (typeof window.matchMedia !== 'function') {
        window.matchMedia = ((query: string) => createMediaQueryList(query, false)) as typeof window.matchMedia;
    }

    const proto = window.Element.prototype;
    if (typeof proto.scrollIntoView !== 'function') {
        proto.scrollIntoView = function scrollIntoView(): void {
            /* لا تخطيط في jsdom */
        };
    }
    if (typeof proto.hasPointerCapture !== 'function') {
        proto.hasPointerCapture = function hasPointerCapture(): boolean {
            return false;
        };
    }
    if (typeof proto.setPointerCapture !== 'function') {
        proto.setPointerCapture = function setPointerCapture(): void {
            /* لا مؤشّر حقيقي في jsdom */
        };
    }
    if (typeof proto.releasePointerCapture !== 'function') {
        proto.releasePointerCapture = function releasePointerCapture(): void {
            /* لا مؤشّر حقيقي في jsdom */
        };
    }

    if (typeof window.PointerEvent === 'undefined') {
        class PointerEventMock extends MouseEvent {
            readonly pointerId = 0;
            readonly pointerType = '';
            readonly isPrimary = true;
            readonly width = 1;
            readonly height = 1;
            readonly pressure = 0;
            readonly tiltX = 0;
            readonly tiltY = 0;
            readonly twist = 0;
        }
        window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent;
    }
}

/* ─── محاكاة prefers-color-scheme ─── */

export interface MatchMediaMock {
    /** تغيير نتيجة الاستعلام وإشعار المستمعين (كأن النظام بدّل الوضع). */
    setMatches(matches: boolean): void;
    /** عدد المستمعين الحاليين — يُثبت إزالة المستمع عند إلغاء الاشتراك. */
    listenerCount(): number;
}

type MediaListener = (event: MediaQueryListEvent) => void;

type InternalMediaQueryList = MediaQueryList & {
    setMatches: (next: boolean) => void;
    listenerCount: () => number;
};

function createMediaQueryList(query: string, matches: boolean): InternalMediaQueryList {
    const listeners = new Set<MediaListener>();
    const mql = {
        matches,
        media: query,
        onchange: null,
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject): void => {
            if (type === 'change' && typeof listener === 'function') {
                listeners.add(listener as MediaListener);
            }
        },
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject): void => {
            if (type === 'change' && typeof listener === 'function') {
                listeners.delete(listener as MediaListener);
            }
        },
        addListener: (listener: MediaListener): void => {
            listeners.add(listener);
        },
        removeListener: (listener: MediaListener): void => {
            listeners.delete(listener);
        },
        dispatchEvent: (): boolean => true,
        setMatches(next: boolean): void {
            mql.matches = next;
            for (const listener of listeners) {
                listener({ matches: next, media: query } as MediaQueryListEvent);
            }
        },
        listenerCount(): number {
            return listeners.size;
        },
    };
    return mql as unknown as InternalMediaQueryList;
}

export function mockMatchMedia(initialMatches = false): MatchMediaMock {
    installDomPolyfills();
    const mql = createMediaQueryList('(prefers-color-scheme: dark)', initialMatches);
    window.matchMedia = vi.fn((query: string) => (query.includes('prefers-color-scheme') ? mql : createMediaQueryList(query, false))) as unknown as typeof window.matchMedia;
    return {
        setMatches: (matches: boolean) => {
            mql.setMatches(matches);
        },
        listenerCount: () => mql.listenerCount(),
    };
}

/* ───axe ─── */

export interface AxeViolation {
    id: string;
    impact: string | null;
    help: string;
    nodes: { target: string[] }[];
}

interface AxeApi {
    run: (context: Element, options?: Record<string, unknown>) => Promise<{ violations: AxeViolation[] }>;
}

let axePromise: Promise<AxeApi | null> | null = null;

function locateAxeCore(): string | null {
    const require = createRequire(import.meta.url);
    const roots = [
        join(process.cwd(), 'node_modules'),
        join(process.cwd(), '../../node_modules'),
        join(process.cwd(), '../../node_modules/.pnpm/node_modules'),
    ];
    for (const root of roots) {
        try {
            return require.resolve('axe-core', { paths: [root] });
        } catch {
            /* جرّب الجذر التالي */
        }
    }
    return null;
}

export function loadAxe(): Promise<AxeApi | null> {
    axePromise ??= (async () => {
        const path = locateAxeCore();
        if (!path) {
            return null;
        }
        const source = readFileSync(path, 'utf8');
        // axe.js وحدة UMD تُثبّت نفسها على `window.axe` عند تنفيذها في DOM.
        new Function(source)();
        const candidate = (window as unknown as { axe?: AxeApi }).axe;
        return candidate ?? null;
    })();
    return axePromise;
}

/**
 * فحص WCAG 2.1 A/AA على حاوية مكوّن — يطابق سياسة البوابة (ADR-004):
 * صفر مخالفات `critical`/`serious`. `color-contrast` معطّل لأن jsdom بلا
 * تخطيط ولا يحسب الألوان المركّبة؛ التباين تُقيسه بوابة الرموز لا jsdom.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
    const axe = await loadAxe();
    if (!axe) {
        return;
    }
    const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        rules: { 'color-contrast': { enabled: false } },
    });
    const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(
        blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            target: violation.nodes.flatMap((node) => node.target),
        })),
    ).toEqual([]);
}

/* ─── تنظيف الثيم ─── */

export function clearTheme(): void {
    installDomPolyfills();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    try {
        window.localStorage.removeItem('karim_theme_v1');
    } catch {
        /* تخزين معطّل */
    }
}
