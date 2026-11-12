import { useState } from 'react';

interface PosProductImageProps {
    src: string;
    name: string;
}

/** Render only the image assigned to this product; missing/broken links use a branded placeholder. */
export function PosProductImage({ src, name }: PosProductImageProps) {
    const [failedSrc, setFailedSrc] = useState('');
    const imageSrc = src.trim();

    if (!imageSrc || failedSrc === imageSrc) {
        return (
            <span className="pos-product-image-fallback" role="img" aria-label={`صورة ${name} غير متاحة`}>
                <span className="pos-product-image-fallback__mark" aria-hidden="true">
                    K
                </span>
                <span className="pos-product-image-fallback__label">Karim POS</span>
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
