import { useState } from 'react';

interface PosProductImageProps {
    src: string;
    name: string;
}

/** أول حرف ظاهر من اسم الصنف — مفتاح الهوية البصرية في الواجهة البديلة. */
function initialOf(name: string): string {
    const trimmed = name.trim();
    return trimmed ? (Array.from(trimmed)[0] ?? '•') : '•';
}

/**
 * صورة الصنف الخاصة به فقط.
 * - تُعرض الصورة إذا كان رابطها مأخوذًا من حقل الصنف نفسه (ومطابقًا لمعرّفه في الرفع الداخلي).
 * - أي رابط مفقود أو تالف يُستبدل بواجهة بديلة أنيقة (تدرّج + أول حرف)،
 *   ولا تُعرض صورة صنف آخر بأي حال.
 */
export function PosProductImage({ src, name }: PosProductImageProps) {
    const [failedSrc, setFailedSrc] = useState('');
    const imageSrc = src.trim();

    if (!imageSrc || failedSrc === imageSrc) {
        return (
            <span className="pos-product-image-fallback" role="img" aria-label={`صورة ${name} غير متاحة`}>
                <span className="pos-product-image-fallback__initial" aria-hidden="true">
                    {initialOf(name)}
                </span>
            </span>
        );
    }

    return (
        <img
            src={imageSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
                setFailedSrc(imageSrc);
            }}
        />
    );
}
