import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../ui/test-utils';
import { FaceCaptureDialog } from './FaceCaptureDialog';

installDomPolyfills();

function mediaStream() {
    const track = { stop: vi.fn() };
    return {
        stream: { getTracks: () => [track] } as unknown as MediaStream,
        track,
    };
}

describe('FaceCaptureDialog camera', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        globalThis.localStorage?.clear?.();
    });

    it('surfaces playback failures and retries from a direct user action', async () => {
        const first = mediaStream();
        const second = mediaStream();
        const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });
        const play = vi
            .spyOn(HTMLMediaElement.prototype, 'play')
            .mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'))
            .mockResolvedValueOnce(undefined);

        render(<FaceCaptureDialog open wantDescriptors={false} onOpenChange={vi.fn()} onComplete={vi.fn()} />);

        await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
        expect(await screen.findByText(/تم فتح الكاميرا لكن تعذر عرض الصورة/)).toBeInTheDocument();
        expect(first.track.stop).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'إعادة تشغيل الكاميرا' }));

        await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(await screen.findByText(/وجّه وجهك للكاميرا ثم اضغط «التقاط»/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'إعادة تشغيل الكاميرا' })).not.toBeInTheDocument();
    });

    it('defaults to the rear camera and switches to front on toggle (persisted)', async () => {
        const getUserMedia = vi.fn().mockImplementation(() => Promise.resolve(mediaStream().stream));
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

        render(<FaceCaptureDialog open wantDescriptors={false} onOpenChange={vi.fn()} onComplete={vi.fn()} />);

        await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
        // الافتراضي: الكاميرا الخلفية
        expect(getUserMedia).toHaveBeenLastCalledWith(
            expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) }),
        );

        // التبديل للأمامية — يعمل ويحفظ الاختيار
        fireEvent.click(screen.getByRole('button', { name: /الكاميرا الخلفية/ }));
        await waitFor(() =>
            expect(getUserMedia).toHaveBeenLastCalledWith(
                expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }) }),
            ),
        );
        expect(globalThis.localStorage?.getItem('karim.faceCapture.facingMode')).toBe('user');
        expect(await screen.findByRole('button', { name: /الكاميرا الأمامية/ })).toBeInTheDocument();
    });
});
