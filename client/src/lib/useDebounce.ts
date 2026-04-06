import { useEffect, useState } from 'react';

/**
 * Debounces a value by the given delay (ms).
 * Syncs with a timer — a legitimate useEffect.
 */
export function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}
