import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import { Download, Trash2, Loader2, ImageIcon, Sparkles, Wand2, ZapIcon, Mic, MicOff, X, ImagePlus, LayoutGrid, Monitor, CalendarDays, Maximize2, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Model = 'dall-e-3' | 'imagen-4';
type DalleSize = '1024x1024' | '1792x1024' | '1024x1792';
type DalleQuality = 'standard' | 'hd';
type DalleStyle = 'vivid' | 'natural';
type ViewMode = 'canvas' | 'gallery';

interface Generation {
    id: number;
    prompt: string;
    model: Model;
    size: string;
    quality?: string;
    style?: string;
    filename: string;
    created_at: string;
}

const SIZE_OPTIONS: { value: DalleSize; label: string }[] = [
    { value: '1024x1024', label: 'Square (1024×1024)' },
    { value: '1792x1024', label: 'Landscape (1792×1024)' },
    { value: '1024x1792', label: 'Portrait (1024×1792)' },
];

const MODELS: { value: Model; label: string; sub: string; icon: React.ReactNode }[] = [
    {
        value: 'dall-e-3',
        label: 'DALL·E 3',
        sub: 'OpenAI',
        icon: <ZapIcon size={14} />,
    },
    {
        value: 'imagen-4',
        label: 'Imagen 4',
        sub: 'Google',
        icon: <Wand2 size={14} />,
    },
];

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader(): Promise<Generation[]> {
    const res = await fetch('/app/api/image-gen/history');
    if (!res.ok) return [];
    return res.json();
}

function imageUrl(filename: string) {
    return `/app/api/image-gen/image/${filename}`;
}

function formatDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function modelLabel(model: string) {
    return model === 'dall-e-3' ? 'DALL·E 3' : 'Imagen 4';
}

export default function ImageGenPage() {
    const initialHistory = useLoaderData() as Generation[];
    const { trackPageView } = useAppTracking('imagegen');
    useEffect(() => { trackPageView(); }, [trackPageView]);
    const { viewMode: viewParam } = useParams<{ viewMode: string }>();
    const viewMode: ViewMode = viewParam === 'gallery' ? 'gallery' : 'canvas';
    const navigate = useNavigate();
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState<Model>('dall-e-3');
    const [size, setSize] = useState<DalleSize>('1024x1024');
    const [quality, setQuality] = useState<DalleQuality>('standard');
    const [style, setStyle] = useState<DalleStyle>('vivid');
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState('');
    const [currentImage, setCurrentImage] = useState<Generation | null>(initialHistory[0] ?? null);
    const [history, setHistory] = useState<Generation[]>(initialHistory);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Generation | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [referenceImage, setReferenceImage] = useState<string | null>(null); // base64 data URL
    const [isDragOver, setIsDragOver] = useState(false);
    const [gallerySelected, setGallerySelected] = useState<Generation | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const voiceSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    function toggleVoice() {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }
        const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = (e) => {
            const transcript = Array.from(e.results)
                .map(r => r[0].transcript)
                .join(' ')
                .trim();
            setPrompt(prev => prev ? `${prev} ${transcript}` : transcript);
        };
        rec.onerror = () => setIsListening(false);
        rec.onend = () => setIsListening(false);
        recognitionRef.current = rec;
        rec.start();
        setIsListening(true);
    }

    const loadReferenceImage = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        // Normalize to PNG via Canvas so the backend always receives image/png
        // (required by DALL·E 2 edit API, and handles jpeg/webp/gif uniformly)
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d')!.drawImage(img, 0, 0);
                setReferenceImage(canvas.toDataURL('image/png'));
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }, []);

    // Global paste handler for reference images — only fires when no text input is focused
    useEffect(() => {
        function onPaste(e: ClipboardEvent) {
            const active = document.activeElement;
            const isTyping = active instanceof HTMLInputElement ||
                active instanceof HTMLTextAreaElement ||
                (active instanceof HTMLElement && active.isContentEditable);
            if (isTyping) return;
            const items = Array.from(e.clipboardData?.items ?? []);
            const imgItem = items.find(i => i.type.startsWith('image/'));
            if (!imgItem) return;
            const file = imgItem.getAsFile();
            if (file) { e.preventDefault(); loadReferenceImage(file); }
        }
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [loadReferenceImage]);


    async function loadHistory() {
        setLoadingHistory(true);
        try {
            const r = await fetch('/app/api/image-gen/history');
            if (r.ok) {
                const data = await r.json();
                setHistory(data);
                if (data.length > 0) setCurrentImage(data[0]);
            }
        } catch {
            // ignore
        } finally {
            setLoadingHistory(false);
        }
    }

    async function generate() {
        if (!prompt.trim()) return;
        setGenerating(true);
        setError('');
        try {
            const r = await fetch('/app/api/image-gen/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt.trim(), model, size, quality, style,
                    ...(referenceImage ? { imageBase64: referenceImage } : {}),
                }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Generation failed');
            setCurrentImage(data);
            setHistory(prev => [data, ...prev]);
            navigate('../canvas', { replace: true });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setGenerating(false);
        }
    }

    function requestDelete(gen: Generation, e: React.MouseEvent) {
        e.stopPropagation();
        setPendingDelete(gen);
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        const id = pendingDelete.id;
        setPendingDelete(null);
        try {
            await fetch(`/app/api/image-gen/${id}`, { method: 'DELETE' });
            setHistory(prev => prev.filter(g => g.id !== id));
            if (currentImage?.id === id) {
                const remaining = history.filter(g => g.id !== id);
                setCurrentImage(remaining[0] ?? null);
            }
            if (gallerySelected?.id === id) setGallerySelected(null);
        } catch {
            // ignore
        }
    }

    function download(gen: Generation) {
        const a = document.createElement('a');
        a.href = imageUrl(gen.filename);
        a.download = `${gen.prompt.slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function remix(gen: Generation) {
        setPrompt(gen.prompt);
        setModel(gen.model);
        if (gen.size && SIZE_OPTIONS.find(o => o.value === gen.size)) {
            setSize(gen.size as DalleSize);
        }
        if (gen.quality) setQuality(gen.quality as DalleQuality);
        if (gen.style) setStyle(gen.style as DalleStyle);
        setGallerySelected(null);
        navigate('../canvas');
    }

    const viewToggle = (
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50">
            <button
                onClick={() => navigate('../canvas')}
                className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
                    viewMode === 'canvas'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                )}
            >
                <Monitor size={12} />
                Canvas
            </button>
            <button
                onClick={() => navigate('../gallery')}
                className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
                    viewMode === 'gallery'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                )}
            >
                <LayoutGrid size={12} />
                Gallery
                {history.length > 0 && (
                    <span className={cn(
                        'ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] leading-none',
                        viewMode === 'gallery' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                        {history.length}
                    </span>
                )}
            </button>
        </div>
    );

    return (
        <AppLayout
            icon={<ImageIcon size={20} />}
            iconClassName="bg-pink-500/10 text-pink-500"
            title="Image Studio"
            subtitle="AI-powered image generation"
            actions={viewToggle}
        >
        <div className="flex h-full overflow-hidden bg-background">
            {/* ── Left control panel — hidden in gallery mode ── */}
            <div className={cn("w-72 shrink-0 flex flex-col border-r border-border bg-card/40 overflow-hidden", viewMode === 'gallery' && "hidden")}>
                <ScrollArea className="flex-1">
                    <div className="px-5 py-4 space-y-5">
                        {/* Prompt */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Prompt
                            </label>
                            <div className="relative">
                                <Textarea
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    placeholder="Describe the image you want to create…"
                                    className="min-h-32 resize-none text-sm leading-relaxed pr-9"
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
                                    }}
                                />
                                {voiceSupported && (
                                    <button
                                        type="button"
                                        onClick={toggleVoice}
                                        title={isListening ? 'Stop dictation' : 'Dictate prompt'}
                                        className={cn(
                                            'absolute bottom-2 right-2 p-1.5 rounded-md transition-all cursor-pointer',
                                            isListening
                                                ? 'text-red-400 bg-red-500/15 animate-pulse'
                                                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60'
                                        )}
                                    >
                                        {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                                    </button>
                                )}
                            </div>

                            {/* Reference image */}
                            {referenceImage ? (
                                <div className="relative rounded-lg overflow-hidden border border-border group">
                                    <img
                                        src={referenceImage}
                                        alt="Reference"
                                        className="w-full max-h-40 object-cover"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <span className="text-xs text-white/80 font-medium">Reference image</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setReferenceImage(null)}
                                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer"
                                        title="Remove reference image"
                                    >
                                        <X size={12} />
                                    </button>
                                    <div className="px-2 py-1 bg-amber-500/10 border-t border-amber-500/20">
                                        <p className="text-[10px] text-amber-400/80">
                                            Edit mode · {model === 'imagen-4' ? 'Imagen 3' : 'DALL·E 2'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => fileInputRef.current?.click()}
                                    onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                                    onDragLeave={() => setIsDragOver(false)}
                                    onDrop={e => {
                                        e.preventDefault();
                                        setIsDragOver(false);
                                        const file = e.dataTransfer.files[0];
                                        if (file) loadReferenceImage(file);
                                    }}
                                    className={cn(
                                        'flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition-all cursor-pointer',
                                        isDragOver
                                            ? 'border-primary/60 bg-primary/5 text-primary'
                                            : 'border-border/50 text-muted-foreground/40 hover:border-border hover:text-muted-foreground/70'
                                    )}
                                >
                                    <ImagePlus size={13} />
                                    <span className="text-[11px]">Add reference image · paste or drag &amp; drop</span>
                                </div>
                            )}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) loadReferenceImage(file);
                                    e.target.value = '';
                                }}
                            />

                            <p className="text-[11px] text-muted-foreground/60 text-right">
                                ⌘↵ to generate
                            </p>
                        </div>

                        {/* Model selector — card-style toggle */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Model
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {MODELS.map(m => (
                                    <button
                                        key={m.value}
                                        onClick={() => setModel(m.value)}
                                        className={cn(
                                            'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all cursor-pointer',
                                            model === m.value
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-border hover:border-border/80 hover:bg-muted/50 text-muted-foreground'
                                        )}
                                    >
                                        <span className={cn('transition-colors', model === m.value ? 'text-primary' : 'text-muted-foreground/60')}>
                                            {m.icon}
                                        </span>
                                        <span className="text-xs font-medium leading-none">{m.label}</span>
                                        <span className="text-[10px] opacity-60">{m.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Options */}
                        <div className="space-y-3">
                            <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Options
                            </label>

                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-muted-foreground shrink-0">Size</span>
                                    <Select value={size} onValueChange={v => setSize(v as DalleSize)}>
                                        <SelectTrigger className="h-8 text-xs w-44">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SIZE_OPTIONS.map(o => (
                                                <SelectItem key={o.value} value={o.value} className="text-xs">
                                                    {o.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {model === 'dall-e-3' && (
                                    <>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-xs text-muted-foreground shrink-0">Quality</span>
                                            <Select value={quality} onValueChange={v => setQuality(v as DalleQuality)}>
                                                <SelectTrigger className="h-8 text-xs w-44">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="standard" className="text-xs">Standard</SelectItem>
                                                    <SelectItem value="hd" className="text-xs">HD</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-xs text-muted-foreground shrink-0">Style</span>
                                            <Select value={style} onValueChange={v => setStyle(v as DalleStyle)}>
                                                <SelectTrigger className="h-8 text-xs w-44">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="vivid" className="text-xs">Vivid</SelectItem>
                                                    <SelectItem value="natural" className="text-xs">Natural</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                {/* Generate button — pinned at bottom */}
                <div className="p-4 border-t border-border">
                    {error && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-3 leading-snug">
                            {error}
                        </div>
                    )}
                    <Button
                        onClick={generate}
                        disabled={generating || !prompt.trim()}
                        className="w-full gap-2"
                        size="lg"
                    >
                        {generating ? (
                            <><Loader2 size={15} className="animate-spin" /> Generating…</>
                        ) : (
                            <><Sparkles size={15} /> Generate Image</>
                        )}
                    </Button>
                </div>
            </div>

            {/* ── Main area ── */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {viewMode === 'canvas' ? (
                    <>
                        {/* Current image */}
                        <div className="flex-1 flex items-center justify-center overflow-hidden p-6">
                            {generating ? (
                                <GeneratingPlaceholder />
                            ) : currentImage ? (
                                <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
                                    <div className="w-full rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/30 bg-card">
                                        <img
                                            src={imageUrl(currentImage.filename)}
                                            alt={currentImage.prompt}
                                            className="w-full object-contain"
                                        />
                                    </div>
                                    <div className="flex items-start justify-between gap-3 w-full px-1">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-muted-foreground leading-snug line-clamp-2">
                                                {currentImage.prompt}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-2">
                                                <Badge variant="secondary" className="text-xs">
                                                    {modelLabel(currentImage.model)}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    {currentImage.size}
                                                </Badge>
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => download(currentImage)}
                                            className="shrink-0 gap-1.5"
                                        >
                                            <Download size={13} />
                                            Download
                                        </Button>
                                    </div>
                                </div>
                            ) : loadingHistory ? (
                                <Skeleton className="w-full max-w-lg aspect-square rounded-2xl" />
                            ) : (
                                <EmptyState />
                            )}
                        </div>

                        {/* History strip */}
                        {history.length > 0 && (
                            <div className="shrink-0 border-t border-border bg-card/30">
                                <div className="px-4 pt-3 pb-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                                        History · {history.length}
                                    </p>
                                </div>
                                <ScrollArea className="w-full">
                                    <div className="flex gap-2 px-4 pb-3 pt-1.5">
                                        {history.map(gen => (
                                            <HistoryThumb
                                                key={gen.id}
                                                gen={gen}
                                                active={currentImage?.id === gen.id}
                                                onSelect={() => setCurrentImage(gen)}
                                                onDelete={e => requestDelete(gen, e)}
                                            />
                                        ))}
                                    </div>
                                    <ScrollBar orientation="horizontal" />
                                </ScrollArea>
                            </div>
                        )}
                    </>
                ) : (
                    <GalleryView
                        history={history}
                        loading={loadingHistory}
                        onSelect={setGallerySelected}
                        onDelete={(gen, e) => requestDelete(gen, e)}
                    />
                )}
            </div>
        </div>

        {/* Delete confirmation */}
        <Dialog open={!!pendingDelete} onOpenChange={open => !open && setPendingDelete(null)}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Delete image?</DialogTitle>
                    <DialogDescription className="line-clamp-2">
                        "{pendingDelete?.prompt}" — this can't be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
                    <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Gallery detail modal */}
        <GalleryModal
            gen={gallerySelected}
            onClose={() => setGallerySelected(null)}
            onDownload={download}
            onRemix={remix}
            onDelete={(gen) => { setGallerySelected(null); setPendingDelete(gen); }}
        />
        </AppLayout>
    );
}

// ── Gallery view ──────────────────────────────────────────────────────────────

function GalleryView({
    history,
    loading,
    onSelect,
    onDelete,
}: {
    history: Generation[];
    loading: boolean;
    onSelect: (gen: Generation) => void;
    onDelete: (gen: Generation, e: React.MouseEvent) => void;
}) {
    if (loading) {
        return (
            <div className="flex-1 overflow-auto p-6">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
                        <LayoutGrid size={24} className="text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">No images yet</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">Generate your first image to see it here</p>
                </div>
            </div>
        );
    }

    return (
        <ScrollArea className="flex-1">
            <div className="p-6">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                    {history.map(gen => (
                        <GalleryCard
                            key={gen.id}
                            gen={gen}
                            onClick={() => onSelect(gen)}
                            onDelete={(e) => onDelete(gen, e)}
                        />
                    ))}
                </div>
            </div>
        </ScrollArea>
    );
}

function GalleryCard({
    gen,
    onClick,
    onDelete,
}: {
    gen: Generation;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={e => e.key === 'Enter' && onClick()}
            className="group relative rounded-xl overflow-hidden border border-border bg-card cursor-pointer transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5"
        >
            {/* Image */}
            <div className="aspect-square overflow-hidden bg-muted/20">
                <img
                    src={imageUrl(gen.filename)}
                    alt={gen.prompt}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                />
            </div>

            {/* Hover overlay with expand icon */}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 rounded-lg p-2">
                    <Maximize2 size={16} className="text-white" />
                </div>
            </div>

            {/* Delete button */}
            <button
                onClick={onDelete}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 cursor-pointer pointer-events-auto z-10"
                title="Delete"
            >
                <Trash2 size={11} />
            </button>

            {/* Card footer */}
            <div className="p-3 space-y-2">
                <p className="text-xs text-foreground/80 leading-snug line-clamp-2 min-h-[2.5rem]">
                    {gen.prompt}
                </p>
                <div className="flex items-center justify-between gap-1">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                        {modelLabel(gen.model)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {new Date(gen.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── Gallery detail modal ──────────────────────────────────────────────────────

function GalleryModal({
    gen,
    onClose,
    onDownload,
    onRemix,
    onDelete,
}: {
    gen: Generation | null;
    onClose: () => void;
    onDownload: (gen: Generation) => void;
    onRemix: (gen: Generation) => void;
    onDelete: (gen: Generation) => void;
}) {
    if (!gen) return null;

    return (
        <Dialog open={!!gen} onOpenChange={open => !open && onClose()}>
            <DialogContent className="p-0 gap-0 overflow-hidden flex flex-row max-w-none sm:max-w-none" style={{ width: 'fit-content', maxWidth: '90vw', height: '90vh' }}>
                    {/* Image panel — image drives its own width via aspect ratio at fixed 90vh height */}
                    <div className="bg-black/80 flex items-center justify-center overflow-hidden shrink-0">
                        <img
                            src={imageUrl(gen.filename)}
                            alt={gen.prompt}
                            style={{ height: '90vh', width: 'auto', display: 'block', maxWidth: 'calc(90vw - 320px)' }}
                        />
                    </div>

                    {/* Details panel */}
                    <div className="w-80 flex-none flex flex-col border-l border-border overflow-hidden">
                        <div className="p-4 border-b border-border">
                            <h2 className="font-semibold text-sm">Image Details</h2>
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="p-4 space-y-4">
                                {/* Prompt */}
                                <div className="space-y-1.5">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prompt</p>
                                    <p className="text-sm leading-relaxed text-foreground/90">{gen.prompt}</p>
                                </div>

                                <Separator />

                                {/* Metadata */}
                                <div className="space-y-2.5">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Details</p>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">Model</span>
                                            <Badge variant="secondary" className="text-xs">
                                                {modelLabel(gen.model)}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">Size</span>
                                            <Badge variant="outline" className="text-xs">{gen.size}</Badge>
                                        </div>
                                        {gen.quality && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">Quality</span>
                                                <span className="text-xs font-medium capitalize">{gen.quality}</span>
                                            </div>
                                        )}
                                        {gen.style && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">Style</span>
                                                <span className="text-xs font-medium capitalize">{gen.style}</span>
                                            </div>
                                        )}
                                        <div className="flex items-start justify-between gap-3">
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <CalendarDays size={10} />
                                                Created
                                            </span>
                                            <span className="text-xs text-muted-foreground/80 text-right">{formatDateTime(gen.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>

                        {/* Actions */}
                        <div className="p-4 border-t border-border space-y-2">
                            <Button
                                className="w-full gap-2"
                                onClick={() => onRemix(gen)}
                            >
                                <RefreshCw size={13} />
                                Remix
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full gap-2"
                                onClick={() => onDownload(gen)}
                            >
                                <Download size={13} />
                                Download
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => onDelete(gen)}
                            >
                                <Trash2 size={13} />
                                Delete
                            </Button>
                        </div>
                    </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GeneratingPlaceholder() {
    return (
        <div className="flex flex-col items-center gap-5 w-full max-w-lg">
            <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 shimmer-sweep" />
                <div className="flex flex-col items-center gap-3 text-muted-foreground/50 relative z-10">
                    <Loader2 size={32} className="animate-spin" />
                    <span className="text-sm font-medium">Generating…</span>
                </div>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex flex-col items-center gap-4 select-none">
            <div className="relative w-48 h-48 rounded-2xl border border-dashed border-border/60 bg-gradient-to-br from-muted/20 to-transparent flex items-center justify-center">
                {/* Decorative corner dots */}
                <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full bg-border/60" />
                <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-border/60" />
                <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full bg-border/60" />
                <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full bg-border/60" />
                <div className="text-muted-foreground/20">
                    <ImageIcon size={48} strokeWidth={1} />
                </div>
            </div>
            <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">Your canvas is empty</p>
                <p className="text-xs text-muted-foreground/50 mt-1">Write a prompt and hit Generate</p>
            </div>
        </div>
    );
}

function HistoryThumb({
    gen,
    active,
    onSelect,
    onDelete,
}: {
    gen: Generation;
    active: boolean;
    onSelect: () => void;
    onDelete: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={e => e.key === 'Enter' && onSelect()}
            title={gen.prompt}
            className={cn(
                'relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border transition-all cursor-pointer group',
                active
                    ? 'border-primary ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : 'border-border/50 hover:border-primary/50 opacity-70 hover:opacity-100'
            )}
        >
            <img
                src={`/app/api/image-gen/image/${gen.filename}`}
                alt={gen.prompt}
                className="w-full h-full object-cover"
            />
            <button
                onClick={onDelete}
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            >
                <Trash2 size={12} className="text-white" />
            </button>
        </div>
    );
}
