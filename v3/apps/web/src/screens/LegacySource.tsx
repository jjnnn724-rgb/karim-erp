import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { StateError, StateLoading } from '../components/TableState';
import { fetchLegacySource, type LegacySourceMode, setLegacySourceMode } from '../lib/legacy-source';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from '../ui';
import { useToast } from '../ui/Toast';
import './LegacySource.css';

/**
 * مصدر البيانات — فصل Yarasoft/Oracle والاعتماد على PostgreSQL وحده.
 *
 * الخادم هو من ينفّذ الفصل فعلًا: يوقف مزامنة Yarasoft والربط المباشر
 * بـOracle، ويحفظ القرار في قاعدة البيانات فلا يُستأنف بعد إعادة التشغيل.
 * الشاشة تعرض الحالة وتمكّن المسؤول من القرار، ولا تكتب أي بيانات قديمة.
 */
export function LegacySource() {
    const queryClient = useQueryClient();
    const confirm = useConfirm();
    const { toast } = useToast();
    const [pendingMode, setPendingMode] = useState<LegacySourceMode | null>(null);

    const status = useQuery({
        queryKey: ['legacy-source'],
        queryFn: ({ signal }) => fetchLegacySource(signal),
        retry: false,
    });

    const save = useMutation({
        mutationFn: (mode: LegacySourceMode) => setLegacySourceMode(mode),
        onSuccess: (data) => {
            queryClient.setQueryData(['legacy-source'], data);
            toast({
                title: data.standalone ? 'النظام الآن مستقل على PostgreSQL' : 'أُعيد الاتصال بمصدر Yarasoft',
                variant: 'success',
            });
        },
        onError: (error: Error) => {
            toast({ title: `تعذّر تغيير الوضع: ${error.message}`, variant: 'error' });
        },
        onSettled: () => {
            setPendingMode(null);
        },
    });

    if (status.isLoading) {
        return <StateLoading label="جارٍ قراءة وضع مصدر البيانات…" />;
    }
    if (status.isError) {
        return (
            <StateError
                message={`تعذّرت قراءة وضع مصدر البيانات: ${(status.error as Error).message}`}
                onRetry={() => void status.refetch()}
            />
        );
    }

    const data = status.data;
    const standalone = data?.mode === 'standalone';

    async function changeMode(next: LegacySourceMode) {
        if (next === data?.mode) return;
        const ok = await confirm(
            next === 'standalone'
                ? 'سيتوقف استيراد فواتير Yarasoft والربط المباشر بـOracle فورًا، ولا يُستأنف بعد إعادة تشغيل الخادم. البيانات المستوردة سابقًا تبقى للقراءة داخل PostgreSQL، وv3 يستمر على قاعدته وحدها.'
                : 'سيعود استيراد Yarasoft والربط المباشر بـOracle للعمل حسب إعداداتهما. تأكد أن ذلك مطلوب قبل المتابعة.',
            {
                title: next === 'standalone' ? 'فصل Yarasoft و Oracle' : 'إعادة الاتصال بالمصدر القديم',
                confirmLabel: next === 'standalone' ? 'افصل واعتمد على PostgreSQL' : 'أعد الاتصال',
                tone: next === 'standalone' ? 'danger' : 'warning',
            },
        );
        if (!ok) return;
        setPendingMode(next);
        save.mutate(next);
    }

    return (
        <div className="legacy-source" dir="rtl">
            <header className="legacy-source__head">
                <div>
                    <h1 className="text-heading-md">مصدر البيانات</h1>
                    <p className="text-body-md text-muted">
                        النظام يعمل على PostgreSQL الخاص به. Yarasoft و Oracle مصدر قراءة فقط للفترة السابقة، ويُفصلان من هنا نهائيًا عند
                        الجاهزية.
                    </p>
                </div>
                <Badge variant={standalone ? 'success' : 'warning'}>{standalone ? 'مستقل — PostgreSQL فقط' : 'متصل بالمصدر القديم'}</Badge>
            </header>

            <div className="legacy-source__grid">
                <Card>
                    <CardHeader>
                        <CardTitle>وضع التشغيل</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <p className="legacy-source__value">{standalone ? 'مستقل' : 'متصل'}</p>
                        <p className="text-body-sm text-muted">
                            {standalone
                                ? 'لا تُنفَّذ أي مزامنة مع Yarasoft أو Oracle، ولا تُقرأ منهما بيانات جديدة. كل العمل على PostgreSQL.'
                                : 'المزامنة مع Yarasoft والربط المباشر بـOracle ممکنان حسب إعداداتهما.'}
                        </p>
                        <div className="legacy-source__actions">
                            <Button
                                variant={standalone ? 'secondary' : 'primary'}
                                loading={save.isPending && pendingMode === (standalone ? 'connected' : 'standalone')}
                                onClick={() => void changeMode(standalone ? 'connected' : 'standalone')}
                            >
                                {standalone ? 'إعادة الاتصال بالمصدر القديم' : 'افصل واعتمد على PostgreSQL'}
                            </Button>
                        </div>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>مزامنة Yarasoft</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <p className="legacy-source__value">{data?.yarasoft.running ? 'تعمل' : 'متوقفة'}</p>
                        <dl className="legacy-source__facts">
                            <div>
                                <dt>آخر دورة</dt>
                                <dd>{data?.yarasoft.lastRunAt ?? '—'}</dd>
                            </div>
                            <div>
                                <dt>مستورد اليوم</dt>
                                <dd>{data?.yarasoft.importedToday ?? '—'}</dd>
                            </div>
                        </dl>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>الربط المباشر Oracle</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <p className="legacy-source__value">{data?.oracle.configured ? 'مُهيّأ' : 'غير مُهيّأ'}</p>
                        <dl className="legacy-source__facts">
                            <div>
                                <dt>الخادم</dt>
                                <dd dir="ltr">{data?.oracle.host ?? '—'}</dd>
                            </div>
                            <div>
                                <dt>الخدمة</dt>
                                <dd dir="ltr">{data?.oracle.service ?? '—'}</dd>
                            </div>
                        </dl>
                        <p className="text-body-sm text-muted">الربط المباشر يعمل في عملية معزولة، ويتوقف تلقائيًا في الوضع المستقل.</p>
                    </CardBody>
                </Card>
            </div>

            <p className="legacy-source__note">
                أرقام الفواتير في v3 تُولَّد من قاعدة النظام بتسلسل مقفول لكل قسم، ولا تعتمد على ترقيم Yarasoft — فلا تتكرر ولا تتعارض مع
                الفترة السابقة.
            </p>
        </div>
    );
}
