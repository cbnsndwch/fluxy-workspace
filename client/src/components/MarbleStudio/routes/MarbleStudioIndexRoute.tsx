import { useNavigate } from 'react-router';
import { Plus, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMarbleContext } from '../context';
import { GalleryCard } from '../components/GalleryCard';
import { WelcomePanel } from '../components/WelcomePanel';

export function MarbleStudioIndexRoute() {
    const { worlds, loading, onDelete } = useMarbleContext();
    const navigate = useNavigate();

    if (loading) {
        return (
            <div className="flex-1 h-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (worlds.length === 0) {
        return <WelcomePanel onNew={() => navigate('/marble-studio/new')} />;
    }

    return (
        <ScrollArea className="h-full">
            <div className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {/* New World card */}
                    <div
                        className="relative cursor-pointer rounded-xl border-2 border-dashed border-border/40 hover:border-green-500/40 transition-all duration-150 hover:bg-green-500/5 flex flex-col items-center justify-center aspect-video text-muted-foreground/40 hover:text-green-500/60 group"
                        onClick={() => navigate('/marble-studio/new')}
                    >
                        <Plus className="h-8 w-8 transition-colors" />
                        <span className="text-xs mt-2 transition-colors">
                            New World
                        </span>
                    </div>

                    {worlds.map((world) => (
                        <GalleryCard
                            key={world.id}
                            world={world}
                            onSelect={() =>
                                navigate(`/marble-studio/worlds/${world.id}`)
                            }
                            onDelete={() => onDelete(world.id)}
                        />
                    ))}
                </div>
            </div>
        </ScrollArea>
    );
}
