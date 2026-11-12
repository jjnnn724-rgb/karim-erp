import './GoodsScan.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { ApiError } from '../lib/api';
import { useAuthState } from '../lib/auth';
import { arSearchKey } from '../lib/employees';
import {
    type AssignDecision,
    assignDecision,
    assignItemBarcode,
    bumpLine,
    CREATE_DISPATCH_ROLES,
    checkExpiryOnLines,
    codeFamily,
    coverage,
    createDispatch,
    dropLine,
    fetchScanDepartments,
    INVENTORY_WRITE_ROLES,
    loadCampaign,
    lookupByCode,
    normalizeCode,
    receiptPayload,
    receiveInventoryItem,
    resolveScan,
    type ScanDepartment,
    type ScanItem,
    type ScanLine,
    searchItems,
    sessionTotals,
    setLineExpiry,
    setLinePrice,
    setLineQty,
    unassignedRows,
    validateGtin,
} from '../lib/goods-scan';
import { formatQty, stockState } from '../lib/inventory-register';

const MODES = [
    { key: 'bind', label: 'ربط كود بصنف', english: 'Bind' },
    { key: 'in', label: 'وارد بالمسح', english: 'Goods IN' },
    { key: 'out', label: 'صرف (أذون)', english: 'Goods OUT' },
    { key: 'campaign', label: 'تغطية الحملة', english: 'Coverage' },
] as const;

type Mode = (typeof MODES)[number]['key'];
type CameraReader = {
    start: (
        camera: { facingMode: string },
        config: { fps: number; qrbox: { width: number; height: number }; formatsToSupport?: number[] },
        onRead: (decoded: string) => void,
        onError: (error: unknown) => void,
    ) => Promise<void>;
    stop: (ignoreIfNotRunning?: boolean) => Promise<void>;
};

declare global {
    interface Window {
        Html5Qrcode?: new (elementId: string, config: { verbose: boolean; useBarCodeDetectorIfSupported: boolean }) => CameraReader;
        Html5QrcodeSupportedFormats?: Record<string, number>;
    }
}

let cameraLoader: Promise<void> | null = null;

function loadCameraReader(): Promise<void> {
    if (window.Html5Qrcode) {
        return Promise.resolve();
    }
    if (cameraLoader) {
        return cameraLoader;
    }
    cameraLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/app/js/v2/vendor/html5-qrcode.min.js';
        script.onload = () => {
            if (window.Html5Qrcode) {
                resolve();
            } else {
                cameraLoader = null;
                reject(new Error('لم يوفّر قارئ المستودع واجهته بعد التحميل'));
            }
        };
        script.onerror = () => {
            cameraLoader = null;
            reject(new Error('تعذّر تحميل قارئ الكاميرا المحلي'));
        };
        document.head.appendChild(script);
    });
    return cameraLoader;
}

function hasRole(role: string, roles: readonly string[]): boolean {
    return roles.includes(role);
}

function errorText(error: unknown): string {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
        return 'انتهت الجلسة — سجّل الدخول في النظام ثم أعد المحاولة.';
    }
    if (error instanceof ApiError && error.code === 'FORBIDDEN') {
        return 'الخادم رفض الكتابة لهذا الحساب — القرار له وحده.';
    }
    return error instanceof Error ? error.message : 'خطأ غير معروف';
}

function ItemSummary({ item }: { item: ScanItem }) {
    const barcode = item.barcode ? normalizeCode(item.barcode) : '';
    return (
        <div className="flex flex-wrap items-center gap-xs rounded-md border border-hairline bg-surface-sunken p-sm">
            <strong className="text-body-md text-ink">{item.name || `#${String(item.id)}`}</strong>
            <span className="text-body-sm text-muted">
                {item.category || '—'} · {item.unit || '—'} · رصيد {formatQty(Number(item.qty) || 0)}
            </span>
            <span className="erp-numeric ms-auto text-body-sm text-muted" dir="ltr">
                {barcode || 'بلا كود'} · {codeFamily(barcode)}
            </span>
        </div>
    );
}

function ConfirmDialog({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-overlay p-md" data-erp-modal-overlay>
            <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="scan-confirm-title"
                className="w-full max-w-lg rounded-lg border border-hairline bg-surface-raised p-lg shadow-[0_24px_64px_rgb(0_0_0/0.30)]"
                data-erp-modal-panel
            >
                <h2 id="scan-confirm-title" className="text-heading-md text-ink">
                    تأكيد ربط الباركود
                </h2>
                <p className="mt-sm text-body-md text-ink-secondary">{message}</p>
                <div className="mt-lg flex justify-end gap-sm">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                    >
                        إلغاء
                    </button>
                    <button type="button" onClick={onConfirm} className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary">
                        تأكيد الربط
                    </button>
                </div>
            </section>
        </div>
    );
}

export function GoodsScan() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const canWriteInventory = hasRole(role, INVENTORY_WRITE_ROLES);
    const canCreateDispatch = hasRole(role, CREATE_DISPATCH_ROLES);
    const cameraId = `goods-scan-camera-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

    const [mode, setMode] = useState<Mode>('bind');
    const modeRef = useRef<Mode>(mode);
    modeRef.current = mode;
    const [codeInput, setCodeInput] = useState('');
    const [status, setStatus] = useState('');
    const [scanBusy, setScanBusy] = useState(false);
    const scanBusyRef = useRef(false);
    const lastScanRef = useRef({ code: '', at: 0 });
    const wedgeRef = useRef({ text: '', last: 0, started: 0 });
    const [resolved, setResolved] = useState<ReturnType<typeof resolveScan> | null>(null);
    const [scanTruncated, setScanTruncated] = useState(false);
    const [pendingCode, setPendingCode] = useState('');
    const [bindSearch, setBindSearch] = useState('');
    const [bindResults, setBindResults] = useState<ScanItem[]>([]);
    const [ambiguousItems, setAmbiguousItems] = useState<ScanItem[]>([]);
    const [inboundLines, setInboundLines] = useState<ScanLine[]>([]);
    const [outboundLines, setOutboundLines] = useState<ScanLine[]>([]);
    const [outboundMeta, setOutboundMeta] = useState<Map<string, { name: string; unit: string; available: number }>>(new Map());
    const [outboundSearch, setOutboundSearch] = useState('');
    const [outboundResults, setOutboundResults] = useState<ScanItem[]>([]);
    const [departmentCode, setDepartmentCode] = useState('');
    const [outboundNotes, setOutboundNotes] = useState('');
    const [posting, setPosting] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraMessage, setCameraMessage] = useState('');
    const [confirmAction, setConfirmAction] = useState<{ message: string; decision: AssignDecision } | null>(null);
    const cameraRef = useRef<CameraReader | null>(null);

    const campaignQuery = useQuery({
        queryKey: ['goods-scan-campaign'],
        queryFn: ({ signal }) => loadCampaign(signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['goods-scan-departments'],
        queryFn: ({ signal }) => fetchScanDepartments(signal),
        enabled: mode === 'out' && canCreateDispatch,
        staleTime: 10 * 60 * 1000,
    });
    const campaignRows = campaignQuery.data?.rows ?? [];
    const campaignCoverage = useMemo(() => coverage(campaignRows), [campaignRows]);
    const inboundTotals = useMemo(() => sessionTotals(inboundLines), [inboundLines]);
    const outboundTotals = useMemo(() => sessionTotals(outboundLines), [outboundLines]);

    useEffect(() => {
        if (!bindSearch.trim() || mode !== 'bind' || !canWriteInventory) {
            setBindResults([]);
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void searchItems(bindSearch, controller.signal)
                .then((items) => setBindResults(items.slice(0, 40)))
                .catch((error: unknown) => {
                    if (!controller.signal.aborted) {
                        setBindResults([]);
                        setStatus(`تعذّر البحث عن الصنف: ${errorText(error)}`);
                    }
                });
        }, 220);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [bindSearch, canWriteInventory, mode]);

    useEffect(() => {
        if (!outboundSearch.trim() || mode !== 'out' || !canCreateDispatch) {
            setOutboundResults([]);
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void searchItems(outboundSearch, controller.signal)
                .then((items) => setOutboundResults(items.filter((item) => Number(item.mainQty) > 0).slice(0, 30)))
                .catch((error: unknown) => {
                    if (!controller.signal.aborted) {
                        setOutboundResults([]);
                        setStatus(`تعذّر البحث اليدوي: ${errorText(error)}`);
                    }
                });
        }, 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [canCreateDispatch, mode, outboundSearch]);

    async function submitCode(raw: string) {
        const code = normalizeCode(raw);
        if (!code) {
            setStatus('لا كود — امسح الباركود أو اكتبه ثم Enter.');
            return;
        }
        const now = performance.now();
        if (lastScanRef.current.code === code && now - lastScanRef.current.at < 350) {
            return;
        }
        lastScanRef.current = { code, at: now };
        setCodeInput('');
        if (scanBusyRef.current) {
            setStatus('جارٍ تنفيذ عملية — انتظر النتيجة.');
            return;
        }
        scanBusyRef.current = true;
        setScanBusy(true);
        setStatus(`جارٍ حلّ الكود ${code}…`);
        try {
            const result = await lookupByCode(code);
            const found = resolveScan(result.rows, code);
            setResolved(found);
            setScanTruncated(result.truncated);
            setPendingCode(!result.truncated && found.state === 'none' ? found.code : '');
            setAmbiguousItems(!result.truncated && found.state === 'ambiguous' ? found.items : []);
            if (result.truncated) {
                setStatus('نتائج البحث مقتطعة — أُوقفت الكتابة لتجنّب ربط أو صرف صنف بناءً على نتيجة غير مكتملة.');
            } else if (modeRef.current === 'in') {
                if (found.state === 'unique') {
                    const item = found.items[0];
                    if (item) {
                        setInboundLines((lines) => bumpLine(lines, String(item.id)));
                        setStatus(`أُضيف «${item.name || item.id}» — المسح المكرّر يعدّ نفس الصنف.`);
                    }
                } else if (found.state === 'ambiguous') {
                    setStatus('الكود على أكثر من صنف — اختر أيهما قبل تسجيل الوارد.');
                } else {
                    setStatus('لا صنف بهذا الكود — اربطه أولًا من وضع «ربط كود بصنف».');
                }
            } else if (modeRef.current === 'out') {
                if (!canCreateDispatch) {
                    setStatus(`حسابك (${role || 'بلا دور'}) لا يُنشئ أذون صرف.`);
                } else if (found.state === 'unique') {
                    const item = found.items[0];
                    if (item) {
                        addOutboundItem(item, true);
                    }
                } else if (found.state === 'ambiguous') {
                    setStatus('الكود على أكثر من صنف — حدّد أيهما يُصرَّف.');
                } else {
                    setStatus('لا صنف بهذا الكود — اربطه أولًا من وضع «ربط كود بصنف».');
                }
            } else if (found.state === 'unique') {
                const item = found.items[0];
                setStatus(`الكود مربوط أصلًا بـ«${item?.name || item?.id}». لتسجيل كمية افتح «وارد بالمسح».`);
            } else if (found.state === 'ambiguous') {
                setStatus(`تحذير: ${String(found.items.length)} أصناف تحمل الكود نفسه — لا تربط مثله قبل إصلاح التكرار.`);
            } else if (!canWriteInventory) {
                setStatus(`الكود غير مربوط. الربط لإدارة المخزن والمدير والمسؤول؛ حسابك (${role || 'بلا دور'}) لا يكتب.`);
            } else {
                const validation = validateGtin(code);
                setStatus(validation.ok ? `الكود ${code} غير مربوط — اختر الصنف ثم اربطه.` : validation.reason);
            }
        } catch (error) {
            setStatus(`تعذّر حلّ الكود: ${errorText(error)}`);
        } finally {
            scanBusyRef.current = false;
            setScanBusy(false);
        }
    }

    useEffect(() => {
        function onKeydown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                wedgeRef.current.text = '';
                return;
            }
            const target = event.target;
            if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
                wedgeRef.current.text = '';
                return;
            }
            if (event.key === 'Enter') {
                const { text, started } = wedgeRef.current;
                wedgeRef.current.text = '';
                if (text.length >= 4 && (performance.now() - started) / text.length < 60) {
                    event.preventDefault();
                    void submitCode(text);
                }
                return;
            }
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const now = performance.now();
                const wedge = wedgeRef.current;
                if (now - wedge.last > 90 || wedge.text.length >= 64) {
                    wedge.text = '';
                    wedge.started = now;
                }
                wedge.last = now;
                wedge.text += event.key;
            }
        }
        document.addEventListener('keydown', onKeydown);
        return () => document.removeEventListener('keydown', onKeydown);
    });

    async function addOutboundItem(item: ScanItem, scanned = false) {
        if (!canCreateDispatch) {
            setStatus('لا صلاحية إنشاء أذون صرف لهذا الحساب.');
            return;
        }
        if (!item.name) {
            setStatus('تعذّر تحديد الصنف — أعد البحث أو المسح.');
            return;
        }
        const available = Number(item.mainQty) || 0;
        if (available <= 0) {
            setStatus(`«${item.name}» لا رصيد له في المخزن الرئيسي — لا يُصرَّف.`);
            return;
        }
        const key = String(item.id);
        setOutboundMeta((previous) => new Map(previous).set(key, { name: item.name ?? key, unit: item.unit || '', available }));
        setOutboundLines((lines) => bumpLine(lines, key));
        setStatus(
            scanned
                ? `أُضيف «${item.name}» بالمسح — المتاح بالرئيسي ${formatQty(available)} ${item.unit || ''}.`
                : `أُضيف «${item.name}» يدويًا — المتاح بالرئيسي ${formatQty(available)} ${item.unit || ''}.`,
        );
    }

    function chooseAmbiguous(item: ScanItem) {
        if (mode === 'in') {
            setInboundLines((lines) => bumpLine(lines, String(item.id)));
            setStatus(`سُجّل الاختيار: «${item.name || item.id}».`);
        } else if (mode === 'out') {
            void addOutboundItem(item);
        }
        setAmbiguousItems([]);
    }

    async function bindTo(itemId: string) {
        if (!pendingCode) {
            setStatus('لا كود معلّق — امسح أولًا.');
            return;
        }
        const campaign = campaignQuery.data ?? (await loadCampaign());
        if (campaign.truncated) {
            setStatus('سجل الأصناف مقتطع عند حدّ القراءة — لا يمكن ضمان عدم تكرار الباركود، فأُوقف الربط.');
            return;
        }
        const decision = assignDecision(campaign.rows, pendingCode, itemId);
        if (['taken', 'invalid', 'empty'].includes(decision.state)) {
            setStatus(decision.message);
            return;
        }
        if (decision.state === 'suspect' || decision.state === 'duplicate') {
            const message =
                decision.state === 'suspect'
                    ? `تحقّق مشكوك فيه: ${decision.message}\nاربط «${decision.item?.name || itemId}» بالكود ${decision.code} رغم ذلك؟`
                    : `${decision.message} — تابع؟`;
            setConfirmAction({ message, decision });
            return;
        }
        await completeBinding(decision);
    }

    async function completeBinding(decision: AssignDecision) {
        if (!decision.item) {
            setStatus('الصنف غير موجود في نتيجة الخادم — أعد البحث.');
            return;
        }
        try {
            await assignItemBarcode(decision.item.id, decision.code);
            setPendingCode('');
            setBindSearch('');
            setResolved(null);
            setStatus(`ربطٌ تمّ: ${decision.code} ← «${decision.item.name || decision.item.id}»`);
            await campaignQuery.refetch();
        } catch (error) {
            setStatus(`تعذّر ربط الكود: ${errorText(error)}`);
        }
    }

    async function postInbound() {
        if (!canWriteInventory || !inboundLines.length) {
            setStatus(!canWriteInventory ? 'لا صلاحية تسجيل وارد لهذا الحساب.' : 'لا أصناف في الجلسة.');
            return;
        }
        const expiry = checkExpiryOnLines(inboundLines, campaignRows);
        if (!expiry.ok) {
            setStatus(`توقف: ${expiry.message}`);
            return;
        }
        setPosting(true);
        const failedKeys = new Set<string>();
        const failures: string[] = [];
        let successCount = 0;
        try {
            for (const line of inboundLines) {
                const item = campaignRows.find((row) => String(row.id) === line.key);
                if (!item) {
                    failedKeys.add(line.key);
                    failures.push(`${line.key} — الصنف غير موجود في نتيجة الخادم`);
                    continue;
                }
                try {
                    await receiveInventoryItem(item.id, receiptPayload(item, line));
                    successCount += 1;
                } catch (error) {
                    failedKeys.add(line.key);
                    failures.push(`${item.name || line.key} — ${errorText(error)}`);
                }
            }
            setInboundLines((lines) => lines.filter((line) => failedKeys.has(line.key)));
            setStatus(
                failures.length
                    ? `سُجّل ${String(successCount)} صنفًا وفشل ${String(failures.length)}: ${failures.join(' | ')}`
                    : `سُجّل وارد ${String(successCount)} صنفًا في الدفتر.`,
            );
            if (successCount) {
                await campaignQuery.refetch();
            }
        } finally {
            setPosting(false);
        }
    }

    async function postOutbound() {
        if (!canCreateDispatch) {
            setStatus('لا صلاحية إنشاء أذون صرف لهذا الحساب.');
            return;
        }
        if (!outboundLines.length) {
            setStatus('لا أصناف في جلسة الصرف.');
            return;
        }
        if (!departmentCode) {
            setStatus('اختر القسم الطالب قبل الإرسال.');
            return;
        }
        const items = outboundLines
            .map((line) => {
                const item = outboundMeta.get(line.key);
                return item && line.qty > 0 ? { itemName: item.name, qty: line.qty, unit: item.unit } : null;
            })
            .filter((item): item is { itemName: string; qty: number; unit: string } => item !== null);
        if (!items.length) {
            setStatus('لا صنف صالح للإرسال — راجع الكميات.');
            return;
        }
        const department = departmentsQuery.data?.find((item) => item.code === departmentCode);
        const today = new Date();
        const date = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        setPosting(true);
        try {
            await createDispatch({
                deptCode: departmentCode,
                ...(department ? { deptName: department.name } : {}),
                items,
                notes: outboundNotes,
                status: 'pending',
                date,
            });
            setStatus(`أُرسل أذون صرف لقسم «${department?.name || departmentCode}» — ${String(items.length)} صنفًا، بانتظار الاعتماد.`);
            setOutboundLines([]);
            setOutboundMeta(new Map());
            setOutboundNotes('');
        } catch (error) {
            if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
                setStatus(`رفض الخادم — ${error.message || 'الرصيد غير كافٍ في المخزن الرئيسي.'}`);
            } else if (error instanceof ApiError && error.code === 'DUPLICATE_DISPATCH') {
                setStatus('أذون مشابه مسجّل بالفعل — لم يتكرر.');
            } else {
                setStatus(`تعذّر إنشاء أذون الصرف: ${errorText(error)}`);
            }
        } finally {
            setPosting(false);
        }
    }

    async function startCamera() {
        setCameraOpen(true);
        if (window.isSecureContext === false) {
            setCameraMessage('كاميرا الجوال تحتاج اتصالًا آمنًا HTTPS أو localhost — أو استخدم قارئ USB.');
            return;
        }
        if (cameraRef.current) {
            setCameraMessage('الكاميرا تعمل بالفعل — وجّه الباركود إلى الإطار.');
            return;
        }
        setCameraMessage('جارٍ تجهيز الكاميرا…');
        try {
            await loadCameraReader();
            const Constructor = window.Html5Qrcode;
            if (!Constructor) {
                throw new Error('قارئ الكاميرا غير متاح');
            }
            const supported = window.Html5QrcodeSupportedFormats;
            const config = { verbose: false, useBarCodeDetectorIfSupported: true };
            const scanner = new Constructor(cameraId, config);
            cameraRef.current = scanner;
            const formats = supported
                ? ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF', 'QR_CODE']
                      .map((name) => supported[name])
                      .filter((value): value is number => Number.isFinite(value))
                : undefined;
            await scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: {
                        width: Math.max(180, Math.min(300, window.innerWidth - 32)),
                        height: Math.max(180, Math.min(280, window.innerHeight * 0.35)),
                    },
                    ...(formats ? { formatsToSupport: formats } : {}),
                },
                (text) => {
                    void stopCamera();
                    void submitCode(text);
                },
                () => {},
            );
            setCameraMessage('وجّه الباركود أو رمز QR إلى الإطار، واسمح للمتصفح باستخدام الكاميرا.');
        } catch (error) {
            cameraRef.current = null;
            setCameraMessage(`تعذّر تشغيل الكاميرا: ${errorText(error)} — امنح الإذن، أو استعمل قارئ USB.`);
        }
    }

    async function stopCamera() {
        const scanner = cameraRef.current;
        cameraRef.current = null;
        if (scanner) {
            try {
                await scanner.stop(true);
            } catch (error) {
                console.error('تعذّر إيقاف قارئ الباركود', error);
            }
        }
        setCameraOpen(false);
    }

    useEffect(() => {
        return () => {
            const scanner = cameraRef.current;
            cameraRef.current = null;
            if (scanner) {
                void scanner.stop(true).catch((error: unknown) => {
                    console.error('تعذّر إيقاف قارئ الباركود عند إغلاق الشاشة', error);
                });
            }
        };
    }, []);

    const unassigned = useMemo(() => {
        const query = arSearchKey(bindSearch);
        const rows = unassignedRows(campaignRows, 2000);
        return query ? rows.filter((item) => arSearchKey(String(item.name ?? '')).includes(query)) : rows;
    }, [bindSearch, campaignRows]);

    const [campaignPage, setCampaignPage] = useState(1);
    const campaignPageCount = Math.max(1, Math.ceil(unassigned.length / 25));
    const pageRows = unassigned.slice((Math.min(campaignPage, campaignPageCount) - 1) * 25, campaignPage * 25);

    function changeMode(next: Mode) {
        setMode(next);
        modeRef.current = next;
        setAmbiguousItems([]);
        setStatus('');
    }

    function resetInbound() {
        setInboundLines([]);
        setStatus('أُفرغت جلسة الوارد.');
    }

    function resetOutbound() {
        setOutboundLines([]);
        setOutboundMeta(new Map());
        setOutboundNotes('');
        setStatus('أُفرغت جلسة الصرف.');
    }

    return (
        <div className="flex flex-col gap-md erp-premium-GoodsScan">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        مسح البضاعة{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Barcode Scan
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        ربط الباركود ثم تسجيل الوارد أو إنشاء أذون صرف معلّق — عبر أبواب المخزون وسلسلة الاعتماد القائمة.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="مسح البضاعة" />
                    <button
                        type="button"
                        onClick={() => void campaignQuery.refetch()}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <Card className="flex flex-col gap-md p-md">
                <div className="flex flex-wrap gap-xs" role="tablist" aria-label="أوضاع مسح البضاعة">
                    {MODES.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={mode === item.key}
                            onClick={() => changeMode(item.key)}
                            className={`rounded-md border px-sm py-xs text-button-md ${
                                mode === item.key
                                    ? 'border-primary bg-primary text-on-primary'
                                    : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            {item.label}{' '}
                            <span className="text-caption opacity-75" dir="ltr" lang="en">
                                {item.english}
                            </span>
                        </button>
                    ))}
                    <span className="ms-auto self-center text-body-sm text-muted">
                        {campaignQuery.isLoading
                            ? 'جارٍ حساب التغطية…'
                            : `${campaignCoverage.assigned}/${campaignCoverage.total} مربوط (${String(campaignCoverage.pct)}%)`}
                    </span>
                </div>

                <p role="status" aria-live="polite" className="min-h-6 text-body-sm text-muted">
                    {status || 'قارئ USB يعمل من أي مكان خارج حقول الكتابة؛ والكود يُطابق حرفيًا بلا مطابقة جزئية.'}
                </p>
                <div className="grid gap-sm md:grid-cols-[minmax(12rem,1fr)_auto_auto_auto] md:items-end">
                    <div className="flex flex-col gap-xxs">
                        <label htmlFor="goods-scan-code" className="text-label-md text-ink">
                            الكود المقروء
                        </label>
                        <input
                            id="goods-scan-code"
                            value={codeInput}
                            onChange={(event) => setCodeInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void submitCode(codeInput);
                                }
                            }}
                            inputMode="numeric"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={100}
                            placeholder="امسح أو اكتب ثم Enter"
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                            dir="ltr"
                        />
                    </div>
                    <button
                        type="button"
                        disabled={scanBusy}
                        onClick={() => void submitCode(codeInput)}
                        className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                    >
                        {scanBusy ? 'جارٍ الحل…' : 'حلّ الكود'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void startCamera()}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                    >
                        كاميرا
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setCodeInput('');
                            wedgeRef.current.text = '';
                            setStatus('فُرِّغ حقل الكود.');
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                    >
                        تفريغ
                    </button>
                </div>
                {cameraOpen ? (
                    <div className="flex flex-col gap-sm rounded-md border border-hairline p-sm">
                        <div id={cameraId} className="min-h-48 w-full overflow-hidden rounded-md bg-sidebar" />
                        <p role="status" aria-live="polite" className="text-body-sm text-muted">
                            {cameraMessage}
                        </p>
                        <button
                            type="button"
                            onClick={() => void stopCamera()}
                            className="self-start rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                        >
                            إيقاف الكاميرا
                        </button>
                    </div>
                ) : null}

                {mode === 'bind' ? (
                    <div className="flex flex-col gap-sm">
                        {resolved?.state === 'unique' && resolved.items[0] ? (
                            <>
                                <ItemSummary item={resolved.items[0]} />
                                <p className={resolved.validation.ok ? 'text-body-sm text-success-text' : 'text-body-sm text-danger-text'}>
                                    {resolved.validation.checked ? resolved.validation.reason : 'لا فحص تحقق لهذا النوع من الأكواد'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => changeMode('in')}
                                    className="self-start rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                                >
                                    تسجيل وارد لهذا الصنف
                                </button>
                            </>
                        ) : resolved?.state === 'ambiguous' ? (
                            <div role="alert" className="flex flex-col gap-xs">
                                <p className="text-body-sm text-danger-text">أكثر من صنف يحمل الكود نفسه؛ أصلح التكرار قبل ربطه.</p>
                                {resolved.items.map((item) => (
                                    <ItemSummary key={String(item.id)} item={item} />
                                ))}
                            </div>
                        ) : pendingCode && canWriteInventory ? (
                            <div className="flex flex-col gap-xs">
                                <p className="text-body-sm text-muted">
                                    الكود {pendingCode} غير مربوط. ابحث عن الصنف، ثم أكّد الاستبدال أو فحص GS1 عند الحاجة.
                                </p>
                                {scanTruncated ? <p className="text-body-sm text-warning-text">بحث الخادم وصل إلى حدّ المشي.</p> : null}
                                <label htmlFor="goods-scan-bind-search" className="text-label-md text-ink">
                                    ابحث عن الصنف بالاسم
                                </label>
                                <input
                                    id="goods-scan-bind-search"
                                    value={bindSearch}
                                    onChange={(event) => setBindSearch(event.target.value)}
                                    type="search"
                                    autoComplete="off"
                                    placeholder="اسم الصنف…"
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                                />
                                {bindResults.length ? (
                                    <div className="flex max-h-64 flex-col gap-xxs overflow-auto">
                                        {bindResults.map((item) => (
                                            <button
                                                key={String(item.id)}
                                                type="button"
                                                onClick={() => void bindTo(String(item.id))}
                                                className="rounded-md border border-hairline bg-surface px-sm py-xs text-start text-body-md text-ink hover:bg-surface-hover"
                                            >
                                                {item.name || `#${String(item.id)}`}{' '}
                                                <span className="text-caption text-muted">{item.category || ''}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : bindSearch.trim() ? (
                                    <StateEmpty title="لا صنف مطابق" hint="راجع الإملاء أو افتح قائمة تغطية الحملة." />
                                ) : null}
                            </div>
                        ) : (
                            <StateEmpty
                                title="امسح كودًا غير مربوط لبدء الربط"
                                hint={
                                    canWriteInventory
                                        ? 'سيظهر البحث عن الصنف بعد قراءة الكود، ثم يُطلب تأكيد صريح عند الاستبدال أو خطأ رقم التحقق.'
                                        : `حسابك (${role || 'بلا دور'}) يقرأ فقط؛ الربط متاح لأدوار إدارة المخزن والمدير والمسؤول.`
                                }
                            />
                        )}
                    </div>
                ) : null}

                {mode === 'in' ? (
                    <div className="flex flex-col gap-sm">
                        <p className="text-body-sm text-muted">
                            الوارد يمرّ بدفتر المخزون، ولا يكتب مباشرةً على الرصيد. الصلاحية اختيارية ويُقبل تاريخها بصيغة YYYY-MM-DD فقط.
                        </p>
                        {ambiguousItems.length ? (
                            <fieldset className="flex flex-col gap-xs">
                                <legend className="text-body-sm text-danger-text">اختر الصنف للوارد</legend>
                                <p className="text-body-sm text-danger-text">الكود مكرر؛ اختر الصنف المقصود قبل إضافة الوارد.</p>
                                {ambiguousItems.map((item) => (
                                    <button
                                        key={String(item.id)}
                                        type="button"
                                        onClick={() => chooseAmbiguous(item)}
                                        className="rounded-md border border-hairline bg-surface px-sm py-xs text-start text-body-md text-ink"
                                    >
                                        {item.name || `#${String(item.id)}`} · {item.unit || ''}
                                    </button>
                                ))}
                            </fieldset>
                        ) : null}
                        {inboundLines.length ? (
                            <TableScroll label="أسطر الوارد">
                                <table className="erp-table w-full min-w-[740px]">
                                    <thead>
                                        <tr>
                                            <th scope="col">الصنف</th>
                                            <th scope="col">المسح</th>
                                            <th scope="col">الكمية</th>
                                            <th scope="col">سعر الوحدة</th>
                                            <th scope="col">الصلاحية</th>
                                            <th scope="col">إجراء</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inboundLines.map((line) => {
                                            const item = campaignRows.find((row) => String(row.id) === line.key);
                                            return (
                                                <tr key={line.key}>
                                                    <th scope="row">{item?.name || line.key}</th>
                                                    <td dir="ltr">{String(line.count)}</td>
                                                    <td>
                                                        <input
                                                            aria-label={`كمية ${item?.name || line.key}`}
                                                            type="number"
                                                            min="0"
                                                            step="0.001"
                                                            value={line.qty}
                                                            onChange={(event) =>
                                                                setInboundLines((lines) => setLineQty(lines, line.key, event.target.value))
                                                            }
                                                            className="w-24 rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm"
                                                        />
                                                    </td>
                                                    <td>
                                                        <input
                                                            aria-label={`سعر ${item?.name || line.key}`}
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={line.price ?? ''}
                                                            placeholder="متوسط التكلفة"
                                                            onChange={(event) =>
                                                                setInboundLines((lines) =>
                                                                    setLinePrice(lines, line.key, event.target.value),
                                                                )
                                                            }
                                                            className="w-28 rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm"
                                                        />
                                                    </td>
                                                    <td>
                                                        <input
                                                            aria-label={`تاريخ صلاحية ${item?.name || line.key}`}
                                                            type="date"
                                                            value={line.expiryDate ?? ''}
                                                            onChange={(event) =>
                                                                setInboundLines((lines) =>
                                                                    setLineExpiry(lines, line.key, event.target.value),
                                                                )
                                                            }
                                                            className="rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm"
                                                        />
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            onClick={() => setInboundLines((lines) => dropLine(lines, line.key))}
                                                            className="text-button-sm text-danger-text"
                                                        >
                                                            حذف
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا توجد أصناف في الجلسة" hint="امسح كل كرتونة؛ تكرار مسح الصنف يزيد عدّ المسح والكمية." />
                        )}
                        <p className="text-body-sm text-muted">
                            {String(inboundTotals.lines)} صنفًا · {String(inboundTotals.scans)} مسحة · {formatQty(inboundTotals.qty)} وحدة
                        </p>
                        {!canWriteInventory ? (
                            <p className="text-body-sm text-danger-text">حسابك لا يكتب الوارد — أزرار التسجيل معطلة وقرار الخادم نهائي.</p>
                        ) : null}
                        <div className="flex flex-wrap gap-sm">
                            <button
                                type="button"
                                disabled={!canWriteInventory || !inboundLines.length || posting}
                                onClick={() => void postInbound()}
                                className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                            >
                                {posting ? 'جارٍ التسجيل…' : 'تسجيل الوارد'}
                            </button>
                            <button
                                type="button"
                                disabled={!inboundLines.length || posting}
                                onClick={resetInbound}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink disabled:opacity-50"
                            >
                                تفريغ الجلسة
                            </button>
                        </div>
                    </div>
                ) : null}

                {mode === 'out' ? (
                    <div className="flex flex-col gap-sm">
                        <p className="text-body-sm text-muted">الصرف ينشئ أذونًا معلّقة تدخل سلسلة الاعتماد.</p>
                        {!canCreateDispatch ? (
                            <p className="text-body-sm text-danger-text">
                                حسابك لا يُنشئ أذون صرف — الأدوار المسموحة: الشيف والمدير والمخازن ورئيس القسم.
                            </p>
                        ) : null}
                        {departmentsQuery.isError ? (
                            <StateError message={errorText(departmentsQuery.error)} onRetry={() => void departmentsQuery.refetch()} />
                        ) : null}
                        {departmentsQuery.isLoading ? <StateLoading label="جارٍ جلب الأقسام" /> : null}
                        {ambiguousItems.length ? (
                            <fieldset className="flex flex-col gap-xs">
                                <legend className="text-body-sm text-danger-text">اختر الصنف للصرف</legend>
                                <p className="text-body-sm text-danger-text">الكود مكرر؛ اختر الصنف المقصود قبل إضافته.</p>
                                {ambiguousItems.map((item) => (
                                    <button
                                        key={String(item.id)}
                                        type="button"
                                        onClick={() => chooseAmbiguous(item)}
                                        className="rounded-md border border-hairline bg-surface px-sm py-xs text-start text-body-md text-ink"
                                    >
                                        {item.name || `#${String(item.id)}`} · {item.unit || ''} · رصيد{' '}
                                        {formatQty(Number(item.mainQty) || 0)}
                                    </button>
                                ))}
                            </fieldset>
                        ) : null}
                        {outboundLines.length ? (
                            <TableScroll label="أسطر إذن الصرف">
                                <table className="erp-table w-full min-w-[580px]">
                                    <thead>
                                        <tr>
                                            <th scope="col">الصنف</th>
                                            <th scope="col">المتاح بالرئيسي</th>
                                            <th scope="col">الكمية</th>
                                            <th scope="col">إجراء</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {outboundLines.map((line) => {
                                            const item = outboundMeta.get(line.key);
                                            const over = line.qty > (item?.available ?? 0);
                                            return (
                                                <tr key={line.key}>
                                                    <th scope="row">{item?.name || line.key}</th>
                                                    <td dir="ltr">
                                                        {formatQty(item?.available ?? 0)} {item?.unit || ''}
                                                    </td>
                                                    <td>
                                                        <input
                                                            aria-label={`كمية صرف ${item?.name || line.key}`}
                                                            type="number"
                                                            min="0"
                                                            step="0.001"
                                                            value={line.qty}
                                                            onChange={(event) =>
                                                                setOutboundLines((lines) => setLineQty(lines, line.key, event.target.value))
                                                            }
                                                            className="w-24 rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-body-sm"
                                                        />
                                                        {over ? (
                                                            <span className="ms-xs text-caption text-danger-text">فوق المتاح</span>
                                                        ) : null}
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setOutboundLines((lines) => dropLine(lines, line.key));
                                                                setOutboundMeta((meta) => {
                                                                    const next = new Map(meta);
                                                                    next.delete(line.key);
                                                                    return next;
                                                                });
                                                            }}
                                                            className="text-button-sm text-danger-text"
                                                        >
                                                            حذف
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا توجد أصناف في جلسة الصرف" hint="امسح باركود صنف له رصيد رئيسي، أو أضفه يدويًا بالاسم." />
                        )}
                        <p className="text-body-sm text-muted">
                            {String(outboundTotals.lines)} صنفًا · {formatQty(outboundTotals.qty)} وحدة
                        </p>
                        {canCreateDispatch ? (
                            <div className="grid gap-sm md:grid-cols-2">
                                <div className="flex flex-col gap-xxs">
                                    <label htmlFor="goods-scan-out-search" className="text-label-md text-ink">
                                        إضافة صنف يدويًا بالاسم
                                    </label>
                                    <input
                                        id="goods-scan-out-search"
                                        value={outboundSearch}
                                        onChange={(event) => setOutboundSearch(event.target.value)}
                                        type="search"
                                        maxLength={100}
                                        autoComplete="off"
                                        placeholder="اكتب اسم الصنف للبحث"
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                                    />
                                    {outboundResults.map((item) => (
                                        <button
                                            key={String(item.id)}
                                            type="button"
                                            onClick={() => {
                                                void addOutboundItem(item);
                                                setOutboundSearch('');
                                                setOutboundResults([]);
                                            }}
                                            className="flex justify-between gap-sm rounded-md border border-hairline bg-surface px-sm py-xs text-start text-body-sm text-ink"
                                        >
                                            <span>
                                                {item.name || `#${String(item.id)}`} · {item.unit || ''}
                                            </span>
                                            <span dir="ltr">متاح {formatQty(Number(item.mainQty) || 0)}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-col gap-xxs">
                                    <label htmlFor="goods-scan-out-dept" className="text-label-md text-ink">
                                        القسم الطالب *
                                    </label>
                                    <select
                                        id="goods-scan-out-dept"
                                        value={departmentCode}
                                        onChange={(event) => setDepartmentCode(event.target.value)}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                                    >
                                        <option value="">— اختر القسم الطالب —</option>
                                        {(departmentsQuery.data ?? []).map((department: ScanDepartment) => (
                                            <option key={department.code} value={department.code}>
                                                {department.name}
                                            </option>
                                        ))}
                                    </select>
                                    <label htmlFor="goods-scan-out-notes" className="mt-sm text-label-md text-ink">
                                        ملاحظات الطلب
                                    </label>
                                    <textarea
                                        id="goods-scan-out-notes"
                                        rows={2}
                                        value={outboundNotes}
                                        onChange={(event) => setOutboundNotes(event.target.value)}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                                    />
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap gap-sm">
                            <button
                                type="button"
                                disabled={!canCreateDispatch || !outboundLines.length || !departmentCode || posting}
                                onClick={() => void postOutbound()}
                                className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                            >
                                {posting ? 'جارٍ الإرسال…' : 'إرسال أذون الصرف'}
                            </button>
                            <button
                                type="button"
                                disabled={!outboundLines.length || posting}
                                onClick={resetOutbound}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink disabled:opacity-50"
                            >
                                تفريغ جلسة الصرف
                            </button>
                        </div>
                    </div>
                ) : null}

                {mode === 'campaign' ? (
                    <div className="flex flex-col gap-sm">
                        {campaignQuery.isError ? (
                            <StateError message={errorText(campaignQuery.error)} onRetry={() => void campaignQuery.refetch()} />
                        ) : campaignQuery.isLoading ? (
                            <TableSkeleton rows={5} columns={4} />
                        ) : (
                            <>
                                <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                    {[
                                        [
                                            'المربوط',
                                            `${String(campaignCoverage.assigned)}/${String(campaignCoverage.total)}`,
                                            `${String(campaignCoverage.pct)}% من السجل المعروض`,
                                        ],
                                        ['بلا كود', String(campaignCoverage.unassigned), 'قائمة العمل أدناه'],
                                        ['أكواد مكررة', String(campaignCoverage.duplicates.length), 'لا يوجد قيد تفريد في قاعدة البيانات'],
                                        ['تحقق GS1 مكسور', String(campaignCoverage.suspect), 'يحتاج مراجعة يدوية'],
                                    ].map(([label, value, hint]) => (
                                        <div key={label} className="rounded-md border border-hairline bg-surface p-sm">
                                            <p className="text-label-md text-muted">{label}</p>
                                            <p className="erp-numeric mt-xs text-heading-md text-ink" dir="ltr">
                                                {value}
                                            </p>
                                            <p className="mt-xxs text-caption text-muted">{hint}</p>
                                        </div>
                                    ))}
                                </div>
                                {campaignQuery.data?.truncated ? (
                                    <p className="text-body-sm text-warning-text">
                                        عُرض أول {String(campaignRows.length)} من {String(campaignQuery.data.total)} صنف — حدّ المشي 2,000.
                                    </p>
                                ) : null}
                                {campaignCoverage.duplicates.length ? (
                                    <p className="text-body-sm text-danger-text">
                                        أكواد مكررة:{' '}
                                        {campaignCoverage.duplicates
                                            .slice(0, 6)
                                            .map((item) => `${item.code}×${String(item.count)}`)
                                            .join('، ')}
                                    </p>
                                ) : (
                                    <p className="text-body-sm text-muted">لا أكواد مكررة في السجل المقروء.</p>
                                )}
                                <label htmlFor="goods-scan-campaign-search" className="text-label-md text-ink">
                                    ابحث في الأصناف بلا كود
                                </label>
                                <input
                                    id="goods-scan-campaign-search"
                                    value={bindSearch}
                                    onChange={(event) => {
                                        setBindSearch(event.target.value);
                                        setCampaignPage(1);
                                    }}
                                    type="search"
                                    className="max-w-lg rounded-md border border-hairline-strong bg-surface px-sm py-xs text-body-md text-ink"
                                />
                                {pageRows.length ? (
                                    <>
                                        <TableScroll label="الأصناف بلا باركود">
                                            <table className="erp-table w-full min-w-[620px]">
                                                <thead>
                                                    <tr>
                                                        <th scope="col">الصنف</th>
                                                        <th scope="col">الفئة</th>
                                                        <th scope="col">الوحدة</th>
                                                        <th scope="col">الرصيد</th>
                                                        <th scope="col">الحالة</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {pageRows.map((item) => {
                                                        const state = stockState(item.qty, item.minQty);
                                                        return (
                                                            <tr key={String(item.id)}>
                                                                <th scope="row">{item.name || `#${String(item.id)}`}</th>
                                                                <td>{item.category || '—'}</td>
                                                                <td>{item.unit || '—'}</td>
                                                                <td dir="ltr">{formatQty(Number(item.qty) || 0)}</td>
                                                                <td>{state.label}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </TableScroll>
                                        <div className="flex items-center justify-between gap-sm text-body-sm">
                                            <span>{String(unassigned.length)} صنفًا بلا كود</span>
                                            <div className="flex gap-xs">
                                                <button
                                                    type="button"
                                                    disabled={campaignPage <= 1}
                                                    onClick={() => setCampaignPage((page) => Math.max(1, page - 1))}
                                                    className="rounded-md border border-hairline-strong px-sm py-xxs disabled:opacity-50"
                                                >
                                                    السابق
                                                </button>
                                                <span dir="ltr">
                                                    {String(Math.min(campaignPage, campaignPageCount))}/{String(campaignPageCount)}
                                                </span>
                                                <button
                                                    type="button"
                                                    disabled={campaignPage >= campaignPageCount}
                                                    onClick={() => setCampaignPage((page) => Math.min(campaignPageCount, page + 1))}
                                                    className="rounded-md border border-hairline-strong px-sm py-xxs disabled:opacity-50"
                                                >
                                                    التالي
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <StateEmpty
                                        title={bindSearch ? 'لا صنف مطابق' : 'كل الأصناف مربوطة'}
                                        hint={bindSearch ? 'امسح البحث أو راجع الإملاء.' : 'اكتملت تغطية الباركود في السجل المقروء.'}
                                    />
                                )}
                            </>
                        )}
                    </div>
                ) : null}
            </Card>

            {confirmAction ? (
                <ConfirmDialog
                    message={confirmAction.message}
                    onCancel={() => setConfirmAction(null)}
                    onConfirm={() => {
                        const decision = confirmAction.decision;
                        setConfirmAction(null);
                        void completeBinding(decision);
                    }}
                />
            ) : null}
        </div>
    );
}
