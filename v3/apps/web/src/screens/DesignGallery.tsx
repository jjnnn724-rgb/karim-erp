import { type ReactNode, useState } from 'react';
import {
    Badge,
    Button,
    Card,
    CardBody,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    Chart,
    Checkbox,
    Combobox,
    DataTable,
    type DataTableColumn,
    Dialog,
    Drawer,
    EmptyState,
    ErrorState,
    IconButton,
    Input,
    KpiTile,
    PageHeader,
    Pagination,
    RadioGroup,
    SearchInput,
    SegmentedControl,
    Select,
    Skeleton,
    Switch,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Textarea,
    ThemeProvider,
    ThemeToggle,
    ToastProvider,
    Tooltip,
    useToast,
} from '../ui';
import { InfoIcon, SearchIcon, XIcon } from '../ui/icons';

/**
 * معرض نظام التصميم — `/design` (ADR-002: بديل Storybook في المرحلة الأولى).
 *
 * يعرض كل مكوّن × حالاته × **الوضعين** (لوحة فاتحة ولوحة داكنة مفروضة بـ
 * `class="dark"`) × RTL، مع عيّنة 500 صف لتجربة التمرير الافتراضي (يستهلكها
 * قياس e2e من perf-a11y عبر `#datatable-virtual-demo`).
 *
 * محمّل كسول من `DesignGallery.lazy.tsx`، وتسجيله في `routes.tsx` ملك Lead.
 * لا يُسجَّل في `screens.ts`/Shell: مسار تطوير داخلي.
 */

/* ─── عناصر العرض ─── */

function Section({
    id,
    title,
    description,
    children,
}: {
    id: string;
    title: string;
    description?: string;
    children: ReactNode;
}) {
    const titleId = `${id}-title`;
    return (
        <section id={id} aria-labelledby={titleId} className="flex scroll-mt-lg flex-col gap-md">
            <div className="flex flex-col gap-xxs border-b border-hairline pb-sm">
                <h2 id={titleId} className="text-heading-lg text-ink">
                    {title}
                </h2>
                {description ? <p className="text-body-sm text-muted">{description}</p> : null}
            </div>
            {children}
        </section>
    );
}

/** لوحة مقارنة: نفس المكوّن في الوضعين (الداكن مفروض محليًا). */
function Modes({ children }: { children: ReactNode }) {
    return (
        <div className="grid gap-md lg:grid-cols-2">
            <div data-mode="light" className="flex flex-col gap-sm rounded-lg border border-hairline bg-canvas p-md">
                <span className="text-caption font-medium text-muted">الوضع الفاتح</span>
                {children}
            </div>
            <div
                data-mode="dark"
                className="dark flex flex-col gap-sm rounded-lg border border-hairline bg-canvas p-md"
            >
                <span className="text-caption font-medium text-muted">الوضع الداكن</span>
                {children}
            </div>
        </div>
    );
}

function Swatch({ className, label }: { className: string; label: string }) {
    return (
        <div className="flex flex-col gap-xxs">
            <span className={`block h-9 w-full rounded-md border border-hairline ${className}`} />
            <span className="text-caption text-muted">{label}</span>
        </div>
    );
}

/* ─── عيّنات تفاعلية ─── */

const CURRENCIES = [
    { value: 'SAR', label: 'ريال سعودي' },
    { value: 'USD', label: 'دولار أمريكي' },
    { value: 'EGP', label: 'جنيه مصري' },
];

const BRANCHES = [
    { value: 'RUH', label: 'الرياض', hint: 'الفرع الرئيسي' },
    { value: 'JED', label: 'جدة' },
    { value: 'DMM', label: 'الدمام' },
];

function SelectDemo() {
    const [value, setValue] = useState('SAR');
    return <Select label="العملة" options={CURRENCIES} value={value} onValueChange={setValue} />;
}

function ComboboxDemo() {
    const [value, setValue] = useState('RUH');
    return <Combobox label="الفرع" options={BRANCHES} value={value} onValueChange={setValue} />;
}

function SearchDemo() {
    const [value, setValue] = useState('');
    return <SearchInput value={value} onChange={setValue} label="بحث في المعرض" />;
}

function CheckboxDemo() {
    const [checked, setChecked] = useState(true);
    return (
        <Checkbox
            label="تذكّرني"
            description="يبقى الدخول فعّالًا"
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
        />
    );
}

function SwitchDemo() {
    const [checked, setChecked] = useState(true);
    return <Switch label="إشعارات البريد" checked={checked} onCheckedChange={setChecked} />;
}

function RadioDemo() {
    const [value, setValue] = useState('cash');
    return (
        <RadioGroup
            label="طريقة الدفع"
            value={value}
            onValueChange={setValue}
            options={[
                { value: 'cash', label: 'نقدًا' },
                { value: 'card', label: 'بطاقة' },
                { value: 'credit', label: 'آجل', disabled: true },
            ]}
        />
    );
}

function SegmentedDemo() {
    const [value, setValue] = useState('week');
    return (
        <SegmentedControl
            label="المدى الزمني"
            value={value}
            onValueChange={setValue}
            options={[
                { value: 'day', label: 'اليوم' },
                { value: 'week', label: 'الأسبوع' },
                { value: 'month', label: 'الشهر' },
            ]}
        />
    );
}

function TabsDemo() {
    return (
        <Tabs defaultValue="summary" dir="rtl">
            <TabsList aria-label="أقسام التقرير">
                <TabsTrigger value="summary">الملخص</TabsTrigger>
                <TabsTrigger value="details">التفاصيل</TabsTrigger>
                <TabsTrigger value="notes" disabled>
                    ملاحظات
                </TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="rounded-md border border-hairline bg-surface p-md">
                محتوى الملخص
            </TabsContent>
            <TabsContent value="details">محتوى التفاصيل</TabsContent>
            <TabsContent value="notes">محتوى الملاحظات</TabsContent>
        </Tabs>
    );
}

function PaginationDemo() {
    const [page, setPage] = useState(2);
    return <Pagination page={page} pageSize={10} total={57} onPageChange={setPage} />;
}

function DialogDemo() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button onClick={() => setOpen(true)}>فتح الحوار</Button>
            <Dialog
                open={open}
                onOpenChange={setOpen}
                title="ترحيل القيد"
                description="بعد الترحيل لا يمكن تعديل القيد."
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            إلغاء
                        </Button>
                        <Button onClick={() => setOpen(false)}>ترحيل</Button>
                    </>
                }
            >
                <p>سيُقفل القيد رقم 1042 نهائيًا في دفتر الأستاذ.</p>
            </Dialog>
        </>
    );
}

function DrawerDemo({ side }: { side: 'start' | 'end' }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="secondary" onClick={() => setOpen(true)}>
                فتح الدرج ({side === 'end' ? 'نهاية' : 'بداية'})
            </Button>
            <Drawer
                open={open}
                onOpenChange={setOpen}
                side={side}
                title="مرشّحات المخزون"
                footer={<Button onClick={() => setOpen(false)}>تطبيق</Button>}
            >
                <div className="flex flex-col gap-sm">
                    <Input label="الصنف" placeholder="اسم أو SKU" />
                    <Select label="الفرع" options={BRANCHES} />
                </div>
            </Drawer>
        </>
    );
}

function ToastDemo() {
    const { toast } = useToast();
    return (
        <div className="flex flex-wrap gap-xs">
            <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                    toast({ title: 'تم الحفظ', description: 'حُفظت التعديلات بنجاح.', variant: 'success' });
                }}
            >
                نجاح
            </Button>
            <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                    toast({ title: 'تعذّر الحفظ', description: 'حاول مرة أخرى.', variant: 'error' });
                }}
            >
                خطأ
            </Button>
            <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                    toast({ title: 'معلومة', description: 'هذه رسالة معلوماتية.' });
                }}
            >
                معلومة
            </Button>
        </div>
    );
}

/* ─── جدول 500 صف (عيّنة perf-a11y) ─── */

interface GalleryInvoice {
    id: string;
    customer: string;
    total: string;
    status: string;
}

const INVOICES_500: GalleryInvoice[] = Array.from({ length: 500 }, (_, index) => ({
    id: `INV-${String(index + 1).padStart(4, '0')}`,
    customer: `عميل ${String(index + 1)}`,
    total: `${(index + 1) * 37}.00`,
    status: index % 5 === 0 ? 'مسوّدة' : 'مرحّل',
}));

const invoiceColumns: DataTableColumn<GalleryInvoice>[] = [
    { key: 'id', header: 'الفاتورة', cell: (row) => row.id, numeric: true },
    { key: 'customer', header: 'العميل', cell: (row) => row.customer },
    {
        key: 'status',
        header: 'الحالة',
        cell: (row) => <Badge variant={row.status === 'مرحّل' ? 'success' : 'neutral'}>{row.status}</Badge>,
    },
    { key: 'total', header: 'الإجمالي', cell: (row) => row.total, numeric: true },
];

const CHART_DATA = [
    { month: 'يناير', revenue: 120000, expense: 80000 },
    { month: 'فبراير', revenue: 140000, expense: 90000 },
    { month: 'مارس', revenue: 132000, expense: 86000 },
    { month: 'أبريل', revenue: 158000, expense: 94000 },
];

const CHART_SERIES = [
    { key: 'revenue', label: 'الإيراد' },
    { key: 'expense', label: 'المصروف' },
];

/* ─── المعرض ─── */

const SECTIONS = [
    { id: 'tokens', title: 'الرموز' },
    { id: 'buttons', title: 'الأزرار' },
    { id: 'fields', title: 'الحقول' },
    { id: 'choices', title: 'الاختيارات' },
    { id: 'badges', title: 'الشارات' },
    { id: 'cards', title: 'البطاقات والمؤشرات' },
    { id: 'navigation', title: 'التبويبات والترقيم' },
    { id: 'feedback', title: 'الحالات والهياكل' },
    { id: 'datatable', title: 'الجداول' },
    { id: 'datatable-virtual-demo', title: 'جدول 500 صف' },
    { id: 'overlays', title: 'النوافذ والدرج' },
    { id: 'toast', title: 'التنبيهات' },
    { id: 'charts', title: 'الرسوم' },
];

function GalleryContent() {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-xl p-md pb-xxl">
            <header className="flex flex-wrap items-start justify-between gap-md">
                <div className="flex flex-col gap-xxs">
                    <h1 className="text-display-lg text-ink">معرض نظام التصميم</h1>
                    <p className="max-w-2xl text-body-md text-muted">
                        ليل الياقوت — مكوّنات ERP في الوضعين الفاتح والداكن. دمج HeroUI تدريجيًا في الأزرار والحقول
                        والبطاقات والشارات، مع الحفاظ على المكونات المتخصصة. كل بيانات هذه الصفحة أمثلة توضيحية وليست
                        بيانات المنشأة.
                    </p>
                </div>
                <ThemeToggle />
            </header>

            <nav aria-label="أقسام المعرض" className="flex flex-wrap gap-xxs">
                {SECTIONS.map((section) => (
                    <a
                        key={section.id}
                        href={`#${section.id}`}
                        className="rounded-full border border-hairline bg-surface px-sm py-1 text-body-sm text-ink-secondary transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover"
                    >
                        {section.title}
                    </a>
                ))}
            </nav>

            <Section id="tokens" title="الرموز" description="ألوان ودلالات ورسوم وحركة — من src/styles.css فقط.">
                <Modes>
                    <div className="grid grid-cols-4 gap-xs sm:grid-cols-6">
                        <Swatch label="canvas" className="bg-canvas" />
                        <Swatch label="surface" className="bg-surface" />
                        <Swatch label="raised" className="bg-surface-raised" />
                        <Swatch label="sunken" className="bg-surface-sunken" />
                        <Swatch label="primary" className="bg-primary" />
                        <Swatch label="brand-text" className="bg-brand-text" />
                        <Swatch label="brass" className="bg-brass" />
                        <Swatch label="copper" className="bg-copper" />
                        <Swatch label="success" className="bg-success" />
                        <Swatch label="warning" className="bg-warning" />
                        <Swatch label="danger" className="bg-danger" />
                        <Swatch label="info" className="bg-info" />
                        <Swatch label="success-soft" className="bg-success-soft" />
                        <Swatch label="warning-soft" className="bg-warning-soft" />
                        <Swatch label="danger-soft" className="bg-danger-soft" />
                        <Swatch label="info-soft" className="bg-info-soft" />
                        <Swatch label="chart-1" className="bg-chart-1" />
                        <Swatch label="chart-2" className="bg-chart-2" />
                        <Swatch label="chart-3" className="bg-chart-3" />
                        <Swatch label="chart-4" className="bg-chart-4" />
                        <Swatch label="chart-5" className="bg-chart-5" />
                        <Swatch label="chart-6" className="bg-chart-6" />
                        <Swatch label="overlay" className="bg-overlay" />
                        <Swatch label="sidebar" className="bg-sidebar" />
                    </div>
                </Modes>
                <Modes>
                    <div className="flex flex-col gap-xs">
                        <span className="text-display-lg font-semibold text-ink">display-lg 30/600</span>
                        <span className="text-heading-lg font-semibold text-ink">heading-lg 22/600</span>
                        <span className="text-heading-md text-ink">heading-md 16/600</span>
                        <span className="text-body-md text-ink">body-md 14/400 النص الافتراضي</span>
                        <span className="text-body-sm text-muted">body-sm 13/400 تلميح</span>
                        <span className="text-caption text-faint">caption 12/400 هامش</span>
                        <span className="erp-numeric text-ink">123,456.78 SAR — أرقام لاتينية</span>
                        <div className="flex flex-wrap items-center gap-xs">
                            <span className="grid size-8 place-items-center rounded-sm border border-hairline bg-surface text-caption">
                                6
                            </span>
                            <span className="grid size-8 place-items-center rounded-md border border-hairline bg-surface text-caption">
                                10
                            </span>
                            <span className="grid size-8 place-items-center rounded-lg border border-hairline bg-surface text-caption">
                                16
                            </span>
                            <span className="grid size-8 place-items-center rounded-xl border border-hairline bg-surface text-caption">
                                20
                            </span>
                            <span className="grid size-8 place-items-center rounded-full border border-hairline bg-surface text-caption">
                                ∞
                            </span>
                            <span className="rounded-md border border-hairline bg-surface px-sm py-xs text-caption shadow-card">
                                shadow-card
                            </span>
                            <span className="rounded-md border border-hairline bg-surface px-sm py-xs text-caption shadow-pop">
                                shadow-pop
                            </span>
                        </div>
                    </div>
                </Modes>
            </Section>

            <Section
                id="buttons"
                title="الأزرار"
                description="idle · hover · focus-visible · active · disabled · loading."
            >
                <Modes>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Button>أساسي</Button>
                        <Button variant="secondary">ثانوي</Button>
                        <Button variant="ghost">شبح</Button>
                        <Button variant="danger">خطِر</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Button size="sm">صغير</Button>
                        <Button>افتراضي</Button>
                        <Button size="lg">كبير</Button>
                        <Button iconStart={<SearchIcon />}>بحث</Button>
                        <Button iconEnd={<InfoIcon />} variant="secondary">
                            تفاصيل
                        </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Button disabled>معطّل</Button>
                        <Button loading>جارٍ الحفظ…</Button>
                        <IconButton label="بحث" icon={<SearchIcon />} />
                        <IconButton label="إغلاق" icon={<XIcon />} variant="secondary" />
                        <IconButton label="تحميل" icon={<SearchIcon />} loading />
                    </div>
                </Modes>
            </Section>

            <Section
                id="fields"
                title="الحقول"
                description="تسمية مرتبطة · تركيز شامبانيا · خطأ aria-invalid · disabled."
            >
                <Modes>
                    <div className="grid gap-sm">
                        <Input label="اسم العميل" placeholder="اكتب الاسم" />
                        <Input label="الكود" hint="أحرف لاتينية كبيرة" placeholder="CUST-001" />
                        <Input label="البريد" error="صيغة البريد غير صحيحة" defaultValue="not-an-email" />
                        <Input label="حقل معطّل" disabled defaultValue="لا يمكن التعديل" />
                        <Textarea label="ملاحظات" rows={2} hint="تظهر في سجل التدقيق" />
                        <SearchDemo />
                        <SelectDemo />
                        <ComboboxDemo />
                    </div>
                </Modes>
            </Section>

            <Section
                id="choices"
                title="الاختيارات"
                description="Checkbox · Switch · Radio · SegmentedControl (أصول native/Radix)."
            >
                <Modes>
                    <div className="flex flex-col gap-md">
                        <CheckboxDemo />
                        <Checkbox label="مختارة" checked onCheckedChange={() => undefined} />
                        <Checkbox label="غير مختارة" checked={false} onCheckedChange={() => undefined} />
                        <SwitchDemo />
                        <RadioDemo />
                        <SegmentedDemo />
                    </div>
                </Modes>
            </Section>

            <Section id="badges" title="الشارات" description="نصّ دائمًا + حدّ بلون النبرة (WCAG 1.4.1).">
                <Modes>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Badge>محايد</Badge>
                        <Badge variant="success">مرحّل</Badge>
                        <Badge variant="warning">معلّق</Badge>
                        <Badge variant="danger">ملغى</Badge>
                        <Badge variant="info">معلومة</Badge>
                        <Badge variant="success" dot>
                            نشط
                        </Badge>
                        <Badge unknown>غير معروف</Badge>
                        <Badge variant="danger" soft={false}>
                            صلب
                        </Badge>
                    </div>
                </Modes>
            </Section>

            <Section
                id="cards"
                title="البطاقات والمؤشرات"
                description="KPI: الرقم أكبر عنصر، والاتجاه سهم + نص لا لون وحده."
            >
                <Modes>
                    <div className="grid gap-sm sm:grid-cols-3">
                        <KpiTile
                            label="الإيراد"
                            value="120,000.00"
                            unit="SAR"
                            delta="+12.5%"
                            trend="up"
                            icon={<InfoIcon />}
                        />
                        <KpiTile
                            label="المصروف"
                            value="80,000.00"
                            unit="SAR"
                            delta="-3.0%"
                            trend="down"
                            tone="success"
                        />
                        <KpiTile label="قيد التحميل" value="0" loading />
                    </div>
                </Modes>
                <Modes>
                    <Card>
                        <CardHeader
                            actions={
                                <Button size="sm" variant="secondary">
                                    إجراء
                                </Button>
                            }
                        >
                            <CardTitle>ملخص الصندوق</CardTitle>
                            <CardDescription>آخر تحديث قبل دقيقتين</CardDescription>
                        </CardHeader>
                        <CardBody className="erp-numeric">1,200.00 SAR</CardBody>
                        <CardFooter>
                            <span className="text-caption text-muted">فتح الصندوق</span>
                        </CardFooter>
                    </Card>
                </Modes>
            </Section>

            <Section id="navigation" title="التبويبات والترقيم" description="PageHeader · Tabs (Radix) · Pagination.">
                <Modes>
                    <div className="flex flex-col gap-md">
                        <PageHeader title="لوحة المحاسب" english="Accountant" description="عيّنة رأس صفحة موحّد" />
                        <TabsDemo />
                        <PaginationDemo />
                    </div>
                </Modes>
                <Tooltip content="تلميح: يفتح بالتركيز وhover" delayDuration={0}>
                    <Button variant="secondary">مرّر فوقي للتلميح</Button>
                </Tooltip>
            </Section>

            <Section
                id="feedback"
                title="الحالات والهياكل"
                description="loading · empty · error — لا منطقة فارغة أبدًا."
            >
                <Modes>
                    <div className="flex flex-col gap-sm">
                        <Skeleton lines={3} label="جارٍ تحميل السجل" />
                        <Skeleton variant="circle" />
                        <Skeleton variant="rect" />
                        <EmptyState
                            title="لا توجد قيود"
                            description="أنشئ قيدًا جديدًا أو غيّر الفترة."
                            action={<Button size="sm">قيد جديد</Button>}
                        />
                        <ErrorState
                            title="مثال: فشل تحميل البيانات"
                            message="هذه حالة عرض توضيحية للمكوّن، وليست خطأً حقيقيًا في الصفحة."
                            onRetry={() => undefined}
                        />
                    </div>
                </Modes>
            </Section>

            <Section
                id="datatable"
                title="الجداول"
                description="DataTable: بيانات · loading · empty · error · بطاقات على الجوال."
            >
                <DataTable<GalleryInvoice>
                    title="آخر الفواتير"
                    caption="آخر الفواتير — عيّنة المعرض"
                    columns={invoiceColumns}
                    rows={INVOICES_500.slice(0, 4)}
                    rowKey={(row) => row.id}
                    pagination={{ page: 1, pageSize: 4, total: 57, onPageChange: () => undefined }}
                />
                <div className="grid gap-md lg:grid-cols-2">
                    <DataTable<GalleryInvoice>
                        caption="جدول قيد التحميل"
                        columns={invoiceColumns}
                        rows={[]}
                        rowKey={(row) => row.id}
                        state="loading"
                    />
                    <DataTable<GalleryInvoice>
                        caption="جدول فارغ"
                        columns={invoiceColumns}
                        rows={[]}
                        rowKey={(row) => row.id}
                        state="empty"
                    />
                    <DataTable<GalleryInvoice>
                        caption="جدول بخطأ"
                        columns={invoiceColumns}
                        rows={[]}
                        rowKey={(row) => row.id}
                        state="error"
                        errorMessage="تعذّر جلب الفواتير."
                        errorTitle="مثال: فشل تحميل البيانات"
                        onRetry={() => undefined}
                    />
                </div>
            </Section>

            <Section
                id="datatable-virtual-demo"
                title="جدول 500 صف — تمرير افتراضي"
                description="أكثر من 200 صف يفعّل @tanstack/react-virtual؛ الصفوف المرسومة جزء صغير والعدّ الكامل محفوظ في aria-rowcount."
            >
                <DataTable<GalleryInvoice>
                    title="500 فاتورة (بيانات مولّدة محليًا — بلا API)"
                    caption="500 فاتورة مولّدة — تمرير افتراضي"
                    columns={invoiceColumns}
                    rows={INVOICES_500}
                    rowKey={(row) => row.id}
                />
            </Section>

            <Section
                id="overlays"
                title="النوافذ والدرج"
                description="Dialog وDrawer على Radix: حبس تركيز، Esc، إعادة تركيز."
            >
                <Modes>
                    <div className="flex flex-wrap items-center gap-xs">
                        <DialogDemo />
                        <DrawerDemo side="end" />
                        <DrawerDemo side="start" />
                    </div>
                </Modes>
            </Section>

            <Section id="toast" title="التنبيهات" description="aria-live واحدة؛ الخطأ role=alert؛ إغلاق تلقائي ويدوي.">
                <Modes>
                    <ToastDemo />
                </Modes>
            </Section>

            <Section
                id="charts"
                title="الرسوم"
                description="Chart غلاف كسول لـRecharts: جدول بيانات بديل لقارئ الشاشة، وألوان chart-1..6."
            >
                <div className="grid gap-md lg:grid-cols-2">
                    <Chart
                        kind="line"
                        title="الإيراد والمصروف"
                        description="آخر أربعة أشهر"
                        data={CHART_DATA}
                        xKey="month"
                        series={CHART_SERIES}
                    />
                    <Chart kind="bar" title="مقارنة شهرية" data={CHART_DATA} xKey="month" series={CHART_SERIES} />
                    <Chart
                        kind="area"
                        title="اتجاه الإيراد"
                        data={CHART_DATA}
                        xKey="month"
                        series={CHART_SERIES.slice(0, 1)}
                    />
                    <Chart
                        kind="pie"
                        title="توزيع الإيراد"
                        data={CHART_DATA}
                        xKey="month"
                        series={CHART_SERIES.slice(0, 1)}
                    />
                </div>
            </Section>

            <footer className="border-t border-hairline pt-md text-caption text-faint">
                <p>
                    المعرض داخلي (مسار تطوير) — كل مكوّن هنا مصدره <span className="erp-numeric">src/ui</span>، والوثيقة
                    المرافقة <span className="erp-numeric">docs/DESIGN-SYSTEM.md</span>.
                </p>
            </footer>
        </div>
    );
}

export function DesignGallery() {
    return (
        <ThemeProvider>
            <ToastProvider>
                <div className="min-h-screen bg-canvas text-ink">
                    <GalleryContent />
                </div>
            </ToastProvider>
        </ThemeProvider>
    );
}
