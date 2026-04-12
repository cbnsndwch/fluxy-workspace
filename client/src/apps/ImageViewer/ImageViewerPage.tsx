import {
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    FileText,
    ImageIcon,
    Paperclip,
    RefreshCw,
    X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';

interface UploadedFile {
    filename: string;
    type: 'image' | 'document';
    url: string;
    size: number;
    createdAt: string;
}

type Filter = 'all' | 'image' | 'document';

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function PdfThumbnail({ filename }: { filename: string }) {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-muted/60 px-2">
            <FileText size={28} className="text-red-400/70 shrink-0" />
            <p className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-2 break-all">
                {filename}
            </p>
        </div>
    );
}

export default function UploadsPage() {
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('all');
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/app/api/uploads');
            const data = await res.json();
            setFiles(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const filtered =
        filter === 'all' ? files : files.filter(f => f.type === filter);

    const imageCount = files.filter(f => f.type === 'image').length;
    const docCount = files.filter(f => f.type === 'document').length;

    const openLightbox = (i: number) => setLightboxIndex(i);
    const closeLightbox = () => setLightboxIndex(null);

    const prev = useCallback(() => {
        setLightboxIndex(i =>
            i === null ? null : (i - 1 + filtered.length) % filtered.length
        );
    }, [filtered.length]);

    const next = useCallback(() => {
        setLightboxIndex(i => (i === null ? null : (i + 1) % filtered.length));
    }, [filtered.length]);

    useEffect(() => {
        if (lightboxIndex === null) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'ArrowRight') next();
            else if (e.key === 'Escape') closeLightbox();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [lightboxIndex, prev, next]);

    const current = lightboxIndex !== null ? filtered[lightboxIndex] : null;

    const subtitleText = loading
        ? 'Loading…'
        : `${files.length} file${files.length !== 1 ? 's' : ''}`;

    return (
        <TooltipProvider>
            <AppLayout
                icon={<Paperclip size={20} />}
                iconClassName="bg-blue-500/10 text-blue-500"
                title="Uploads"
                subtitle={subtitleText}
                actions={
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={fetchFiles}
                                disabled={loading}
                            >
                                <RefreshCw
                                    size={15}
                                    className={loading ? 'animate-spin' : ''}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Refresh</TooltipContent>
                    </Tooltip>
                }
            >
                <div className="flex flex-col h-full">
                    {/* Filter bar */}
                    {!loading && files.length > 0 && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                            {(['all', 'image', 'document'] as Filter[]).map(
                                f => {
                                    const count =
                                        f === 'all'
                                            ? files.length
                                            : f === 'image'
                                              ? imageCount
                                              : docCount;
                                    const active = filter === f;
                                    return (
                                        <button
                                            key={f}
                                            onClick={() => {
                                                setFilter(f);
                                                setLightboxIndex(null);
                                            }}
                                            className="cursor-pointer"
                                        >
                                            <Badge
                                                variant={
                                                    active
                                                        ? 'default'
                                                        : 'outline'
                                                }
                                                className="gap-1 cursor-pointer"
                                            >
                                                {f === 'image' && (
                                                    <ImageIcon size={11} />
                                                )}
                                                {f === 'document' && (
                                                    <FileText size={11} />
                                                )}
                                                {f === 'all'
                                                    ? 'All'
                                                    : f === 'image'
                                                      ? 'Images'
                                                      : 'Documents'}
                                                <span className="opacity-60">
                                                    {count}
                                                </span>
                                            </Badge>
                                        </button>
                                    );
                                }
                            )}
                        </div>
                    )}

                    {/* Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
                            Loading…
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
                            <Paperclip size={40} className="opacity-20" />
                            <p className="text-sm">
                                {files.length === 0
                                    ? 'No uploads yet — send an image or PDF in chat'
                                    : `No ${filter === 'image' ? 'images' : 'documents'} found`}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-y-auto flex-1 p-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                {filtered.map((file, i) => (
                                    <button
                                        key={file.filename}
                                        onClick={() => openLightbox(i)}
                                        className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted hover:border-blue-500/50 transition-colors cursor-pointer"
                                    >
                                        {file.type === 'image' ? (
                                            <>
                                                <img
                                                    src={file.url}
                                                    alt={file.filename}
                                                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                                                    loading="lazy"
                                                />
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                                            </>
                                        ) : (
                                            <PdfThumbnail
                                                filename={file.filename}
                                            />
                                        )}
                                        <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-linear-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                            <p className="text-[10px] text-white/90 truncate">
                                                {file.filename}
                                            </p>
                                            <p className="text-[9px] text-white/60">
                                                {formatBytes(file.size)}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </AppLayout>

            {/* Lightbox */}
            <Dialog
                open={lightboxIndex !== null}
                onOpenChange={open => !open && closeLightbox()}
            >
                <DialogContent className="max-w-5xl w-full p-0 bg-black/95 border-0 gap-0 overflow-hidden">
                    {current && (
                        <div className="flex flex-col h-[90vh]">
                            {/* Top bar */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    {current.type === 'document' ? (
                                        <FileText
                                            size={15}
                                            className="text-red-400 shrink-0"
                                        />
                                    ) : (
                                        <ImageIcon
                                            size={15}
                                            className="text-blue-400 shrink-0"
                                        />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm text-white font-medium truncate max-w-md">
                                            {current.filename}
                                        </p>
                                        <p className="text-xs text-white/50 mt-0.5">
                                            {formatDate(current.createdAt)} ·{' '}
                                            {formatBytes(current.size)} ·{' '}
                                            {lightboxIndex! + 1} of{' '}
                                            {filtered.length}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
                                                asChild
                                            >
                                                <a
                                                    href={current.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <ExternalLink size={16} />
                                                </a>
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            Open in new tab
                                        </TooltipContent>
                                    </Tooltip>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
                                        onClick={closeLightbox}
                                    >
                                        <X size={16} />
                                    </Button>
                                </div>
                            </div>

                            {/* Content area */}
                            <div className="flex-1 flex items-center justify-center relative overflow-hidden min-h-0">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={prev}
                                    className="absolute left-3 z-10 text-white/70 hover:text-white hover:bg-white/10 h-10 w-10 cursor-pointer"
                                >
                                    <ChevronLeft size={22} />
                                </Button>

                                {current.type === 'image' ? (
                                    <img
                                        key={current.url}
                                        src={current.url}
                                        alt={current.filename}
                                        className="max-w-full max-h-full object-contain"
                                    />
                                ) : (
                                    <iframe
                                        key={current.url}
                                        src={current.url}
                                        title={current.filename}
                                        className="w-full h-full border-0"
                                    />
                                )}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={next}
                                    className="absolute right-3 z-10 text-white/70 hover:text-white hover:bg-white/10 h-10 w-10 cursor-pointer"
                                >
                                    <ChevronRight size={22} />
                                </Button>
                            </div>

                            {/* Filmstrip */}
                            <div className="shrink-0 border-t border-white/10 px-4 py-2 overflow-x-auto">
                                <div className="flex gap-2">
                                    {filtered.map((file, i) => (
                                        <button
                                            key={file.filename}
                                            onClick={() => setLightboxIndex(i)}
                                            className={`shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition-colors cursor-pointer ${
                                                i === lightboxIndex
                                                    ? 'border-blue-500'
                                                    : 'border-transparent opacity-50 hover:opacity-80'
                                            }`}
                                        >
                                            {file.type === 'image' ? (
                                                <img
                                                    src={file.url}
                                                    alt={file.filename}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                                    <FileText
                                                        size={20}
                                                        className="text-red-400/70"
                                                    />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
}
