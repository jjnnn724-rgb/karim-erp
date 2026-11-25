import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Recipes } from './Recipes';

export const Route = createLazyRoute('/recipes')({
    component: () => (
        <ScreenGate screen="recipes">
            <Recipes />
        </ScreenGate>
    ),
});
