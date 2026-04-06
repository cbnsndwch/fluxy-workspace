import { useNavigate } from 'react-router';
import {
    Trash2, Download, ExternalLink, AlertCircle, ChevronLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { PropsWithChildren } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarbleWorld {
    id: number;
    name: string;
    prompt: string;
    prompt_type: string;
    model: string;
    world_id: string | null;
    operation_id: string | null;
    status: 'pending' | 'generating' | 'done' | 'error';
    error_msg: string | null;
    assets_json: string | null;
    thumbnail_url: string | null;
    caption: string | null;
    created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSpzUrls(world: MarbleWorld): Record<string, string> {
    if (!world.assets_json) return {};
    try {
        const assets = JSON.parse(world.assets_json);
        return assets?.splats?.spz_urls || {};
    } catch {
        return {};
    }
}

function getBestSpzUrl(world: MarbleWorld): string | null {
    const urls = getSpzUrls(world);
    return urls['500k'] || urls['full_res'] || urls['100k'] || null;
}

function viewerSrc(world: MarbleWorld): string {
    const assets = world.assets_json;
    if (!assets) return '';
    const encoded = encodeURIComponent(assets);
    return `/app/api/marble-studio/viewer?assets=${encoded}`;
}

// ── Classic World Viewer ──────────────────────────────────────────────────────


type Props = PropsWithChildren<{
    world: MarbleWorld;
    onDelete: () => void;
}>;
    
export default function WorldViewerClassic({ world, onDelete, children }: Props) {
    const navigate = useNavigate();
    const spzUrl = getBestSpzUrl(world);
    const src = spzUrl ? viewerSrc(world) : null;

    if (world.status === 'error') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
                <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-4 left-4 gap-1 text-xs text-muted-foreground cursor-pointer"
                    onClick={() => navigate('/marble-studio')}
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Gallery
                </Button>
                <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
                    <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <div className="text-center">
                    <p className="font-semibold">Generation Failed</p>
                    <p className="text-sm text-muted-foreground mt-1">{world.error_msg || 'An unknown error occurred'}</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 cursor-pointer text-red-500 border-red-500/30 hover:border-red-500/60"
                    onClick={onDelete}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                </Button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* 3D Canvas */}
            <div className="flex-1 min-h-0 relative bg-[#050508]">
                {src ? (
                    <iframe
                        key={world.id}
                        src={src}
                        title={world.name}
                        className="w-full h-full border-0"
                        allow="cross-origin-isolated"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                        No SPZ file available
                    </div>
                )}
                {/* Back to gallery */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-3 left-3 z-10 h-7 gap-1 text-xs text-white/60 hover:text-white bg-accent/50 hover:bg-accent cursor-pointer"
                    onClick={() => navigate('/marble-studio')}
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Gallery
                </Button>

                 {/* children allow adding HUD elements */}
                {children}
            </div>

            {/* Metadata footer */}
            <div className="border-t border-border/50 bg-card px-5 py-3">
                <div className="flex items-start gap-6">
                    <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{world.name}</p>
                            <Badge variant="outline" className="text-[10px] py-0 border-green-500/30 text-green-500 shrink-0">
                                {world.model}
                            </Badge>
                        </div>
                        {world.caption && (
                            <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                                {world.caption}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground/50 italic line-clamp-1">
                            "{world.prompt}"
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <TooltipProvider>
                            {spzUrl && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" asChild>
                                            <a href={spzUrl} download target="_blank" rel="noopener noreferrer">
                                                <Download className="h-3.5 w-3.5" />
                                            </a>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Download SPZ</TooltipContent>
                                </Tooltip>
                            )}
                            {world.world_id && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" asChild>
                                            <a
                                                href={`https://app.worldlabs.ai/worlds/${world.world_id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open in World Labs</TooltipContent>
                                </Tooltip>
                            )}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-red-500 cursor-pointer"
                                        onClick={onDelete}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete world</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            </div>
        </div>
    );
}
