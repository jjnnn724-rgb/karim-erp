import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { AiAssistant } from './AiAssistant';

/** المساعد الذكي — التحليلات المقارنة والتنبيهات (admin/manager/accountant). */
export const Route = createLazyRoute('/ai-assistant')({
    component: () => (
        <ScreenGate screen="ai-assistant">
            <AiAssistant />
        </ScreenGate>
    ),
});
