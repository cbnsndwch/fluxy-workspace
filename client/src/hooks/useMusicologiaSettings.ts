import { useState } from 'react';

const STORAGE_KEY = 'musicologia:reduced-motion';

/**
 * Persisted reduced-motion preference for the Musicologia app.
 * Defaults to the OS/browser `prefers-reduced-motion` setting on first visit.
 * Stored in localStorage so it survives page reloads.
 */
export function useMusicologiaSettings() {
    const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) return stored === 'true';
        return (
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
            false
        );
    });

    const toggleReducedMotion = () => {
        setReducedMotion(prev => {
            const next = !prev;
            localStorage.setItem(STORAGE_KEY, String(next));
            return next;
        });
    };

    return { reducedMotion, toggleReducedMotion };
}
