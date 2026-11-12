import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { PrintActions } from '../components/PrintActions';
import { useAuthState } from '../lib/auth';
import {
    backupVisible,
    KOT_READ_ROLES,
    punchVisible,
    roleIn,
    settingsReadVisible,
    settingsWriteVisible,
    ZATCA_READ_ROLES,
} from '../lib/settings-write';
import { Button } from '../ui/Button';
import { BackupSection } from './settings/BackupSection';
import { CardsSection } from './settings/CardsSection';
import { GeneralSection } from './settings/GeneralSection';
import { KotSection } from './settings/KotSection';
import { MaintenanceSection } from './settings/MaintenanceSection';
import { NavSection } from './settings/NavSection';
import { PunchSection } from './settings/PunchSection';
import { ServerControlSection } from './settings/ServerControlSection';
import { ZatcaSection } from './settings/ZatcaSection';

/**
 * إعدادات النظام — شاشة واحدة بثمانية أقسام تعادل V2 كاملًا:
 * عام، القائمة الجانبية، ZATCA، تذاكر المطبخ، بطاقات الموظفين، البصمة الذاتية،
 * النسخ الاحتياطي، التصدير والتصفير. كل قسم يُحمَّل عند أول زيارة ويبقى مثبَّتًا
 * بعدها حتى لا تُفقد مسودة غير محفوظة عند التنقل بين الأقسام.
 */

type SectionKey = 'general' | 'nav' | 'zatca' | 'kot' | 'cards' | 'punch' | 'backup' | 'maintenance' | 'server';

interface SectionDef {
    key: SectionKey;
    label: string;
    english: string;
    render: () => ReactNode;
}

const SECTION_DEFS: SectionDef[] = [
    { key: 'general', label: 'عام', english: 'General', render: () => <GeneralSection /> },
    { key: 'nav', label: 'القائمة الجانبية', english: 'Navigation', render: () => <NavSection /> },
    { key: 'zatca', label: 'الفاتورة الضريبية', english: 'ZATCA', render: () => <ZatcaSection /> },
    { key: 'kot', label: 'تذاكر المطبخ', english: 'Kitchen Tickets', render: () => <KotSection /> },
    { key: 'cards', label: 'بطاقات الموظفين', english: 'Employee Cards', render: () => <CardsSection /> },
    { key: 'punch', label: 'البصمة الذاتية', english: 'Self Punch', render: () => <PunchSection /> },
    { key: 'backup', label: 'النسخ الاحتياطي', english: 'Backups', render: () => <BackupSection /> },
    { key: 'maintenance', label: 'التصدير والتصفير', english: 'Export & Reset', render: () => <MaintenanceSection /> },
    { key: 'server', label: 'تحكم الخادم', english: 'Server Control', render: () => <ServerControlSection /> },
];

export function Settings() {
    const auth = useAuthState();
    const role = auth.user?.role;
    const queryClient = useQueryClient();
    const fetching = useIsFetching({ queryKey: ['settings'] });

    const visibleSections = useMemo(() => {
        return SECTION_DEFS.filter((section) => {
            switch (section.key) {
                case 'general':
                case 'nav':
                    return settingsReadVisible(role);
                case 'zatca':
                    return roleIn(role, ZATCA_READ_ROLES);
                case 'kot':
                    return roleIn(role, KOT_READ_ROLES);
                case 'cards':
                    return Boolean(auth.user);
                case 'punch':
                    return punchVisible(role);
                case 'backup':
                    return backupVisible(role);
                case 'maintenance':
                    return settingsWriteVisible(role);
                case 'server':
                    return role === 'admin';
                default:
                    return false;
            }
        });
    }, [auth.user, role]);

    const [active, setActive] = useState<SectionKey>('general');
    const [visited, setVisited] = useState<ReadonlySet<SectionKey>>(() => new Set<SectionKey>(['general']));

    useEffect(() => {
        if (visibleSections.length === 0) {
            return;
        }
        if (!visibleSections.some((section) => section.key === active)) {
            const first = visibleSections[0];
            if (first) {
                setActive(first.key);
            }
        }
    }, [active, visibleSections]);

    function select(key: SectionKey): void {
        setActive(key);
        setVisited((current) => (current.has(key) ? current : new Set(current).add(key)));
    }

    const mounted = SECTION_DEFS.filter(
        (section) => visibleSections.some((visible) => visible.key === section.key) && visited.has(section.key),
    );

    return (
        <div className="flex flex-col gap-lg">
            <PageHeader
                title="الإعدادات"
                english="System Settings"
                actions={
                    <>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={fetching > 0}
                            onClick={() => {
                                void queryClient.invalidateQueries({ queryKey: ['settings'] });
                            }}
                        >
                            تحديث
                        </Button>
                        <PrintActions title="إعدادات النظام" />
                    </>
                }
            />

            {visibleSections.length === 0 ? (
                <p className="rounded-lg border border-dashed border-hairline-strong px-md py-xl text-center text-body-md text-muted">
                    لا توجد أقسام متاحة لهذا الحساب.
                </p>
            ) : (
                <div className="grid gap-lg lg:grid-cols-[15rem_minmax(0,1fr)]">
                    <nav aria-label="أقسام الإعدادات" className="min-w-0">
                        <ul className="flex gap-xs overflow-x-auto pb-xs lg:sticky lg:top-lg lg:flex-col lg:overflow-visible lg:pb-0">
                            {visibleSections.map((section) => {
                                const current = section.key === active;
                                return (
                                    <li key={section.key} className="shrink-0 lg:shrink">
                                        <button
                                            type="button"
                                            aria-current={current ? 'page' : undefined}
                                            onClick={() => select(section.key)}
                                            className={
                                                current
                                                    ? 'flex w-full items-center justify-between gap-xs rounded-md border border-hairline-strong bg-surface px-sm py-xs text-start text-body-md font-semibold text-ink shadow-card'
                                                    : 'flex w-full items-center justify-between gap-xs rounded-md border border-transparent px-sm py-xs text-start text-body-md text-ink-secondary transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover'
                                            }
                                        >
                                            <span className="whitespace-nowrap">{section.label}</span>
                                            <span className="hidden text-caption text-faint lg:inline" dir="ltr" lang="en">
                                                {section.english}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    <div className="min-w-0">
                        {mounted.map((section) => (
                            <div key={section.key} hidden={section.key !== active}>
                                {section.render()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
