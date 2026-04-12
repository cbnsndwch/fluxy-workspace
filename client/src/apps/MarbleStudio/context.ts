import { useOutletContext } from 'react-router';

import { MarbleStudioContext } from './types';

export function useMarbleContext() {
    return useOutletContext<MarbleStudioContext>();
}
