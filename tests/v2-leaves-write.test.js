/**
 * v2-leaves-write.test.js — عقد إنشاء الإجازات والإعادة والإرسال في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: leave-workflow-routes.js:149 (:156/:159/:168) + hr.js:588-629.
 * يمتد عقد v2-leaves.test.js دون تعديله.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'leaves-repo.js');
const SCREEN = path.join(V2, 'screens', 'leaves.js');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

describe('الإجازات — الإنشاء', () => {
    test('باب الإنشاء بنفس المسار والحمولة', async () => {
        const { apiFetch, calls } = repoStub(() => ({ stage_label: 'المدير المباشر' }));
        const ctx = loadEsm(REPO, { apiFetch }, ['createLeaveRequest']);
        await ctx.createLeaveRequest({
            employeeId: 9, leaveTypeId: 2, startDate: '2026-10-20', endDate: '2026-10-22', reason: 'ظرف',
        });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /hr/leave-requests']);
        expect(JSON.parse(calls[0].body)).toEqual({
            employeeId: 9, leaveTypeId: 2, startDate: '2026-10-20', endDate: '2026-10-22', reason: 'ظرف',
        });
    });

    test('التواريخ المقلوبة تُرفض محليًا بنفس جملة الخادم', async () => {
        const { apiFetch } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, ['createLeaveRequest']);
        await expect(ctx.createLeaveRequest({
            employeeId: 9, leaveTypeId: 2, startDate: '2026-10-22', endDate: '2026-10-20', reason: '',
        })).rejects.toThrow('تحقق من نوع الإجازة والتواريخ');
        expect(apiFetch).not.toHaveBeenCalled();
    });

    test('decideLeave يقبل الإعادة والإرسال ويرفض المجهول بنفس الجملة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, ['decideLeave']);
        await ctx.decideLeave(5, 'return', 'أرفق التقرير');
        await ctx.decideLeave(5, 'resubmit', '');
        await expect(ctx.decideLeave(5, 'bogus', '')).rejects.toThrow('إجراء غير معروف — المتاح: اعتماد أو رفض.');
        expect(calls.map((c) => JSON.parse(c.body).action)).toEqual(['return', 'resubmit']);
    });
});

describe('الإجازات — عقد الشاشة', () => {
    const src = () => read(SCREEN);

    test('الإنشاء والإعادة والإرسال حاضرة', () => {
        const s = src();
        for (const k of ['data-v2-new', 'data-v2-new-send', 'data-v2-new-emp',
            'data-v2-new-type', 'data-v2-new-from', 'data-v2-new-to', 'data-v2-new-reason',
            'data-v2-return', 'data-v2-return-send', 'data-v2-act="return"',
            'data-v2-act="resubmit"', 'createLeaveRequest', 'isPrivilegedLeaveRole']) {
            expect(s).toContain(k);
        }
    });

    test('بلا شبكة مباشرة ولا معالج سطري', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });
});
