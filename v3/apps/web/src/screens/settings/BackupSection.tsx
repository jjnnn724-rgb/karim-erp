import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { TableScroll } from '../../components/TableState';
import { type BackupFile, type RestoreResult, formatBytes } from '../../lib/settings';
import {
    backupVisible,
    createBackup,
    fetchBackups,
    restoreBackup,
    uploadBackup,
} from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { useAuthState } from '../../lib/auth';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { Input } from '../../ui/Input';
import { Switch } from '../../ui/Switch';
import { useToast } from '../../ui/Toast';
import { QueryBoundary, SectionCard, formatStamp } from './shared';

/**
 * النسخ الاحتياطية — نظير لوحة V2 كاملة: قائمة الملفات مع فحص SHA، إنشاء نسخة،
 * رفع ملف `.sql`، واستعادة مقيّدة بعبارة `RESTORE` مكتوبة يدويًا مع خيار
 * استعادة متغيّرات البيئة.
 */

function shaBadge(file: BackupFile) {
    if (!file.hasSha) {
        return (
            <Badge variant="neutral" dot>
                بلا بصمة
            </Badge>
        );
    }
    if (file.shaOk === true) {
        return (
            <Badge variant="success" dot>
                مطابقة
            </Badge>
        );
    }
    if (file.shaOk === false) {
        return (
            <Badge variant="danger" dot>
                غير مطابقة
            </Badge>
        );
    }
    return (
        <Badge variant="warning" dot>
            غير مُتحقَّق
        </Badge>
    );
}

export function BackupSection() {
    const auth = useAuthState();
    const canUse = backupVisible(auth.user?.role);
    const { toast } = useToast();
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [verify, setVerify] = useState(true);
    const [uploadError, setUploadError] = useState('');
    const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
    const [restorePhrase, setRestorePhrase] = useState('');
    const [restoreEnv, setRestoreEnv] = useState(false);
    const [restoreError, setRestoreError] = useState('');

    const query = useQuery({
        queryKey: ['settings', 'backups', verify],
        queryFn: () => fetchBackups(verify),
        refetchOnWindowFocus: false,
        enabled: canUse,
    });

    const files = [...(query.data?.files ?? [])].sort((a, b) => b.mtime.localeCompare(a.mtime));

    const create = useWriteMutation<void, unknown>({
        mutationFn: () => createBackup(),
        successTitle: 'تم إنشاء نسخة احتياطية',
        invalidate: [['settings', 'backups']],
        silentError: true,
        onError: (cause) => {
            setUploadError(writeErrorMessage(cause, 'تعذّر إنشاء النسخة'));
        },
    });

    const upload = useWriteMutation<File, unknown>({
        mutationFn: (file) => uploadBackup(file),
        successTitle: 'تم رفع النسخة',
        invalidate: [['settings', 'backups']],
        silentError: true,
        onSuccess: () => {
            setUploadError('');
        },
        onError: (cause) => {
            setUploadError(writeErrorMessage(cause, 'تعذّر رفع النسخة'));
        },
    });

    const restore = useWriteMutation<{ file: string; env: boolean }, RestoreResult>({
        mutationFn: (vars) => restoreBackup(vars.file, vars.env),
        successTitle: 'تمت استعادة النسخة',
        invalidate: [['settings']],
        silentError: true,
        onSuccess: (result) => {
            if (result.restartNeeded) {
                toast({
                    variant: 'info',
                    title: 'يلزم إعادة تشغيل الخادم',
                    description: 'المحتوى المستعاد يُحمَّل بعد إعادة التشغيل',
                });
            }
            closeRestore();
        },
        onError: (cause) => {
            setRestoreError(writeErrorMessage(cause, 'تعذّرت الاستعادة'));
        },
    });

    function closeRestore(): void {
        setRestoreTarget(null);
        setRestorePhrase('');
        setRestoreEnv(false);
        setRestoreError('');
    }

    const phraseOk = restorePhrase.trim() === 'RESTORE';
    const busy = create.isPending || upload.isPending || restore.isPending;

    if (!canUse) {
        return null;
    }

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="النسخ الاحتياطية"
                english="Database Backups"
                badge={
                    <Badge variant="neutral" dot>
                        {files.length} ملف
                    </Badge>
                }
                actions={
                    <div className="flex flex-wrap items-center gap-xs">
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={create.isPending}
                            disabled={busy}
                            onClick={() => {
                                setUploadError('');
                                create.mutate();
                            }}
                        >
                            نسخة جديدة
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                            رفع نسخة
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".sql,application/sql"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (!file) {
                                    return;
                                }
                                setUploadError('');
                                upload.mutate(file);
                            }}
                        />
                    </div>
                }
            >
                <div className="flex flex-wrap items-center justify-between gap-sm">
                    <Switch label="فحص بصمة SHA عند القراءة" checked={verify} onCheckedChange={setVerify} />
                    <span className="text-caption text-faint" dir="ltr">
                        {query.data?.dir ?? ''}
                    </span>
                </div>

                {uploadError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {uploadError}
                    </p>
                ) : null}

                <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                    {files.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-hairline-strong px-md py-lg text-center text-body-sm text-muted">
                            لا توجد نسخ محفوظة
                        </p>
                    ) : (
                        <TableScroll label="ملفات النسخ الاحتياطية">
                            <table className="erp-table__grid">
                                <thead>
                                    <tr>
                                        <th scope="col">الملف</th>
                                        <th scope="col">الحجم</th>
                                        <th scope="col">التاريخ</th>
                                        <th scope="col">البصمة</th>
                                        <th scope="col">المنشئ</th>
                                        <th scope="col" className="w-px" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.map((file) => (
                                        <tr key={file.file}>
                                            <td className="max-w-72 truncate font-mono text-body-sm" dir="ltr" title={file.file}>
                                                {file.file}
                                            </td>
                                            <td dir="ltr">{formatBytes(file.bytes)}</td>
                                            <td dir="ltr">{formatStamp(file.mtime)}</td>
                                            <td>{shaBadge(file)}</td>
                                            <td>
                                                {file.manifest?.by ? (
                                                    <span className="text-body-sm">
                                                        {file.manifest.by}
                                                        {file.manifest.createdAt ? (
                                                            <span className="block text-caption text-faint" dir="ltr">
                                                                {formatStamp(file.manifest.createdAt)}
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                ) : (
                                                    <span className="text-faint">—</span>
                                                )}
                                            </td>
                                            <td>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        setRestoreTarget(file);
                                                        setRestorePhrase('');
                                                        setRestoreEnv(false);
                                                        setRestoreError('');
                                                    }}
                                                >
                                                    استعادة
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                </QueryBoundary>
            </SectionCard>

            <Dialog
                open={restoreTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        closeRestore();
                    }
                }}
                title="استعادة نسخة احتياطية"
                {...(restoreTarget ? { description: restoreTarget.file } : {})}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" size="sm" onClick={closeRestore} disabled={restore.isPending}>
                            إلغاء
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            loading={restore.isPending}
                            disabled={!phraseOk}
                            onClick={() => {
                                if (!restoreTarget) {
                                    return;
                                }
                                setRestoreError('');
                                restore.mutate({ file: restoreTarget.file, env: restoreEnv });
                            }}
                        >
                            استعادة
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-md">
                    <p className="text-body-sm text-danger-text">
                        تُستبدل البيانات الحالية بمحتوى الملف، ويحتاج الخادم إلى إعادة تشغيل بعدها.
                    </p>
                    <Input
                        label="اكتب RESTORE للتأكيد"
                        dir="ltr"
                        autoComplete="off"
                        value={restorePhrase}
                        onChange={(event) => setRestorePhrase(event.target.value)}
                        {...(restorePhrase.length > 0 && !phraseOk ? { error: 'العبارة غير مطابقة' } : {})}
                    />
                    <Checkbox
                        label="استعادة متغيّرات البيئة أيضًا"
                        checked={restoreEnv}
                        onCheckedChange={(checked) => setRestoreEnv(checked === true)}
                    />
                    {restoreError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {restoreError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </div>
    );
}
