import { useEffect, useState } from 'react';

/**
 * Returns true if the user has requested reduced motion via
 * the OS/browser `prefers-reduced-motion: reduce` setting.
 * Updates reactively if the preference changes while the app is open.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(
        () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    return reduced;
}
