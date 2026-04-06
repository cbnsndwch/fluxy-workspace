import { Badge } from '@/components/ui/badge';
import { MarbleWorld } from '../types';

export function StatusBadge({ status }: { status: MarbleWorld['status'] }) {
    if (status === 'done')
        return (
            <Badge
                variant="outline"
                className="text-[10px] py-0 border-green-500/40 text-green-500"
            >
                Ready
            </Badge>
        );
    if (status === 'generating' || status === 'pending')
        return (
            <Badge
                variant="outline"
                className="text-[10px] py-0 border-amber-500/40 text-amber-500 gap-1"
            >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                Generating
            </Badge>
        );
    return (
        <Badge
            variant="outline"
            className="text-[10px] py-0 border-red-500/40 text-red-500"
        >
            Error
        </Badge>
    );
}
