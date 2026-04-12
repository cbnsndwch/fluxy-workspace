import { Globe2, Plus, Sparkles, ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface WelcomePanelProps {
    onNew: () => void;
}

export function WelcomePanel({ onNew }: WelcomePanelProps) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="h-20 w-20 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <Globe2 className="h-10 w-10 text-green-500/60" />
            </div>
            <div>
                <h2 className="text-xl font-semibold">
                    World Labs Marble Studio
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm leading-relaxed">
                    Generate explorable 3D Gaussian Splat worlds from text,
                    images, video, or multi-view captures using World Labs
                    Marble AI.
                </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-left max-w-lg w-full">
                {[
                    {
                        icon: Sparkles,
                        title: 'Text to 3D',
                        desc: 'Describe a place in natural language'
                    },
                    {
                        icon: ImageIcon,
                        title: 'Image to 3D',
                        desc: 'Use a panorama or reference image'
                    },
                    {
                        icon: Globe2,
                        title: 'Interactive',
                        desc: 'Explore your world in full 360° WebGL'
                    }
                ].map(({ icon: Icon, title, desc }) => (
                    <div
                        key={title}
                        className="rounded-xl border border-border/50 bg-card p-4 space-y-1.5"
                    >
                        <Icon className="h-4 w-4 text-green-500/70" />
                        <p className="text-sm font-medium">{title}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                ))}
            </div>
            <Button onClick={onNew} className="gap-2 cursor-pointer">
                <Plus className="h-4 w-4" />
                Generate Your First World
            </Button>
        </div>
    );
}
