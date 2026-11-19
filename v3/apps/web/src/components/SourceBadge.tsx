import { isMirrorSource, SOURCE_LABELS, type SourceKind } from '../lib/source-tag';

/**
 * شارة المصدر — عنصرٌ واحد لوسم مصدر البيانات في كل شاشة.
 *
 * الشارة تُعلن المصدر صراحةً: مرآة خارجية (نصٌّ تحذيري) أو سجل KarimERP
 * الرسمي (محايد). ليست زينةً ولاTooltips: هي عقدُ حدود البيانات مرئيًّا.
 */
export function SourceBadge({ kind, syncedAt }: { kind: SourceKind; syncedAt?: string | null }) {
    const label = SOURCE_LABELS[kind];
    const mirror = isMirrorSource(kind);
    return (
        <span
            className={`inline-flex items-center gap-xxs rounded-md border px-xs py-xxs text-caption ${
                mirror ? 'border-warning bg-surface text-warning-text' : 'border-hairline bg-surface-sunken text-muted'
            }`}
            title={syncedAt ? `آخر مزامنة: ${syncedAt}` : undefined}
        >
            <span aria-hidden="true">{mirror ? '⚠' : '•'}</span>
            <span>{mirror ? `${label.ar} — انتقال` : label.ar}</span>
            {syncedAt ? (
                <span className="opacity-80" dir="ltr">
                    {syncedAt}
                </span>
            ) : null}
        </span>
    );
}
