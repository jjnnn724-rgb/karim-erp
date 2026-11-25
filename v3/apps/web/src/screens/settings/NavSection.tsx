import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fetchJson } from '../../lib/api';
import { getAccessToken, useAuthState } from '../../lib/auth';
import { NAV_GROUPS, NAV_TITLES } from '../../lib/navigation';
import { hiddenNavKeys, joinHiddenNav, mainSettingsSchema } from '../../lib/settings';
import { SETTINGS_TEXT, saveMainSettings, settingsWriteVisible } from '../../lib/settings-write';
import { useWriteMutation, writeErrorMessage } from '../../lib/write';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { QueryBoundary, SaveBar, SectionCard, useDraftForm } from './shared';

/**
 * ظهور القائمة الجانبية — `hidden_nav_pages` في صف الإعدادات نفسه (admin).
 * الرئيسية والإعدادات لا تُخفَيان حتى لا يُقفل المسؤول على نفسه.
 * مفاتيح قديمة من V2 لا تظهر في V3 تبقى محفوظة كما هي عند الحفظ.
 */

interface NavForm {
    hidden: string[];
}

const HIDDEN_LOCKED = new Set(['settings']);

const NAV_ROWS = NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.keys.filter((key) => !HIDDEN_LOCKED.has(key)).map((key) => ({ key, label: NAV_TITLES[`/${key}`] ?? key })),
}));

export function NavSection() {
    const auth = useAuthState();
    const canWrite = settingsWriteVisible(auth.user?.role);
    const [error, setError] = useState('');

    const query = useQuery({
        queryKey: ['settings', 'main'],
        queryFn: ({ signal }) => fetchJson(mainSettingsSchema, '/api/settings', getAccessToken(), { signal }),
        refetchOnWindowFocus: false,
    });

    const data = query.data ?? null;
    const stored = useMemo(() => hiddenNavKeys(data?.hidden_nav_pages ?? ''), [data?.hidden_nav_pages]);
    const known = useMemo(() => new Set(NAV_ROWS.flatMap((group) => group.items.map((item) => item.key))), []);
    const unknown = useMemo(() => stored.filter((key) => !known.has(key) && !HIDDEN_LOCKED.has(key)), [stored, known]);
    const signature = JSON.stringify({ hidden: stored });
    const draft = useDraftForm<NavForm>(data ? { hidden: stored } : null, signature);

    const save = useWriteMutation<NavForm, void>({
        mutationFn: (form) =>
            saveMainSettings(data?.id ?? 'main_settings', {
                name: data?.name ?? '',
                hidden_nav_pages: joinHiddenNav([...unknown, ...form.hidden]),
            }),
        successTitle: () => 'تم تحديث ظهور القوائم',
        invalidate: [['settings', 'main']],
        silentError: true,
        onSuccess: () => {
            setError('');
            draft?.commit();
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, SETTINGS_TEXT.saveFailed));
        },
    });

    if (!draft || !data) {
        return (
            <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
                <span />
            </QueryBoundary>
        );
    }

    const hidden = new Set(draft.value.hidden);

    const toggle = (key: string, next: boolean) => {
        const selected = new Set(draft.value.hidden);
        if (next) {
            selected.add(key);
        } else {
            selected.delete(key);
        }
        const ordered = NAV_ROWS.flatMap((group) => group.items.map((item) => item.key)).filter((entry) => selected.has(entry));
        draft.set('hidden', ordered);
    };

    return (
        <div className="flex flex-col gap-lg">
            <SectionCard
                title="ظهور القائمة"
                english="Sidebar Visibility"
                badge={<Badge variant={hidden.size ? 'warning' : 'neutral'}>{`${String(hidden.size)} مخفي`}</Badge>}
                actions={
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || hidden.size === 0}
                        onClick={() => {
                            draft.set('hidden', []);
                        }}
                    >
                        إظهار الكل
                    </Button>
                }
            >
                <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
                    {NAV_ROWS.map((group) => (
                        <section key={group.id} className="rounded-lg border border-hairline bg-surface-sunken p-sm">
                            <div className="mb-xs flex items-center justify-between gap-sm">
                                <h3 className="text-heading-sm text-ink">{group.label}</h3>
                                <span className="text-caption text-faint" dir="ltr" lang="en">
                                    {group.id}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 gap-xs sm:grid-cols-2">
                                {group.items.map((item) => (
                                    <Checkbox
                                        key={item.key}
                                        label={item.label}
                                        checked={hidden.has(item.key)}
                                        disabled={!canWrite}
                                        onCheckedChange={(checked) => {
                                            toggle(item.key, checked === true);
                                        }}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </SectionCard>

            <SaveBar
                dirty={draft.dirty}
                saving={save.isPending}
                {...(error ? { error } : {})}
                onSave={() => {
                    setError('');
                    save.mutate(draft.value);
                }}
                onReset={() => {
                    setError('');
                    draft.reset();
                }}
                disabled={!canWrite}
            />
        </div>
    );
}
