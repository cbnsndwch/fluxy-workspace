import { useState } from 'react';
import {
    Sparkles,
    Shuffle,
    Plus,
    Trash2,
    AlertCircle,
    Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';

import { MarbleWorld, PromptMode, ImageSlot } from '../types';
import { MODELS, PRESETS } from '../constants';
import { newSlot } from '../utils';

interface GenerationFormProps {
    onGenerated: (world: MarbleWorld) => void;
}

export function GenerationForm({ onGenerated }: GenerationFormProps) {
    const [name, setName] = useState('');
    const [model, setModel] = useState<string>('marble-1.1');
    const [mode, setMode] = useState<PromptMode>('text');

    // Text mode
    const [textPrompt, setTextPrompt] = useState('');

    // Image mode
    const [imageUrl, setImageUrl] = useState('');
    const [isPano, setIsPano] = useState(false);
    const [imageText, setImageText] = useState('');

    // Multi-image mode
    const [slots, setSlots] = useState<ImageSlot[]>(() => [newSlot()]);
    const [multiText, setMultiText] = useState('');

    // Video mode
    const [videoUrl, setVideoUrl] = useState('');
    const [videoText, setVideoText] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const rollRandom = () => {
        const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
        setTextPrompt(p.prompt);
    };

    const pickPreset = (preset: (typeof PRESETS)[0]) => {
        setMode('text');
        setTextPrompt(preset.prompt);
        if (!name.trim()) setName(preset.label);
    };

    const addSlot = () => {
        if (slots.length >= 8) return;
        setSlots((prev) => [...prev, newSlot()]);
    };

    const removeSlot = (id: string) => {
        setSlots((prev) => prev.filter((s) => s.id !== id));
    };

    const updateSlot = (
        id: string,
        field: keyof Omit<ImageSlot, 'id'>,
        value: string,
    ) => {
        setSlots((prev) =>
            prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setSubmitting(true);
        setError('');

        try {
            const body: Record<string, unknown> = {
                name: name.trim(),
                model,
                prompt_type: mode,
            };

            switch (mode) {
                case 'text':
                    if (!textPrompt.trim()) {
                        setError('Please enter a world description');
                        setSubmitting(false);
                        return;
                    }
                    body.prompt = textPrompt.trim();
                    break;
                case 'image':
                    if (!imageUrl.trim()) {
                        setError('Please enter an image URL');
                        setSubmitting(false);
                        return;
                    }
                    body.image_url = imageUrl.trim();
                    body.is_pano = isPano;
                    body.prompt = imageText.trim();
                    break;
                case 'multi-image': {
                    const valid = slots.filter((s) => s.url.trim());
                    if (!valid.length) {
                        setError('Add at least one image URL');
                        setSubmitting(false);
                        return;
                    }
                    body.images = valid.map((s) => ({
                        url: s.url.trim(),
                        azimuth: parseFloat(s.azimuth) || 0,
                    }));
                    body.prompt = multiText.trim();
                    break;
                }
                case 'video':
                    if (!videoUrl.trim()) {
                        setError('Please enter a video URL');
                        setSubmitting(false);
                        return;
                    }
                    body.video_url = videoUrl.trim();
                    body.prompt = videoText.trim();
                    break;
                default:
                    setError('Select an input mode');
                    setSubmitting(false);
                    return;
            }

            const res = await fetch('/app/api/marble-studio/worlds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Generation failed');
                return;
            }
            onGenerated(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setSubmitting(false);
        }
    };

    const presetCategories = Array.from(
        new Set(PRESETS.map((p) => p.category)),
    );

    const isSubmitDisabled =
        submitting ||
        !name.trim() ||
        (mode === 'text'
            ? !textPrompt.trim()
            : mode === 'image'
              ? !imageUrl.trim()
              : mode === 'multi-image'
                ? !slots.some((s) => s.url.trim())
                : mode === 'video'
                  ? !videoUrl.trim()
                  : false);

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-8 py-10">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="h-9 w-9 rounded-xl bg-green-500/10 flex items-center justify-center">
                            <Sparkles className="h-4.5 w-4.5 text-green-500" />
                        </div>
                        <h2 className="text-lg font-semibold">
                            Generate a New World
                        </h2>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Describe a place and Marble AI will generate an
                        explorable 3D Gaussian Splat world. Generation takes 1–3
                        minutes.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Name + Model row */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="world-name">World Name</Label>
                            <Input
                                id="world-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Glacial Grotto, Wind Temple…"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Model</Label>
                            <Select value={model} onValueChange={setModel}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MODELS.map((m) => (
                                        <SelectItem
                                            key={m.value}
                                            value={m.value}
                                        >
                                            <span className="flex items-center gap-2">
                                                <m.icon className="h-3.5 w-3.5 opacity-60" />
                                                <span>{m.label}</span>
                                                <span className="text-muted-foreground text-xs">
                                                    {m.sub}
                                                </span>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Prompt mode tabs */}
                    <Tabs
                        value={mode}
                        onValueChange={(v) => setMode(v as PromptMode)}
                    >
                        <TabsList className="w-full">
                            <TabsTrigger value="text" className="flex-1">
                                Text
                            </TabsTrigger>
                            <TabsTrigger value="image" className="flex-1">
                                Image
                            </TabsTrigger>
                            <TabsTrigger
                                value="multi-image"
                                className="flex-1 text-xs"
                            >
                                Multi-Image
                            </TabsTrigger>
                            <TabsTrigger value="video" className="flex-1">
                                Video
                            </TabsTrigger>
                            <TabsTrigger value="presets" className="flex-1">
                                Presets
                            </TabsTrigger>
                        </TabsList>

                        {/* ── Text ──────────────────────────────────────────── */}
                        <TabsContent value="text" className="space-y-3 pt-4">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="text-prompt">
                                        World Description
                                    </Label>
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 cursor-pointer text-muted-foreground hover:text-foreground"
                                                    onClick={rollRandom}
                                                >
                                                    <Shuffle className="h-3.5 w-3.5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                Random prompt
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <Textarea
                                    id="text-prompt"
                                    value={textPrompt}
                                    onChange={(e) =>
                                        setTextPrompt(e.target.value)
                                    }
                                    rows={6}
                                    placeholder="A breathtaking mythical floating temple high in the clouds, honoring ancient wind deities. Towering columns of glowing translucent glass, infinite sky, mirror pools reflecting the heavens…"
                                    className="resize-none"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Be spatial and specific — describe
                                    materials, lighting, architecture, and
                                    atmosphere.
                                </p>
                            </div>
                        </TabsContent>

                        {/* ── Image ─────────────────────────────────────────── */}
                        <TabsContent value="image" className="space-y-4 pt-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="image-url">Image URL</Label>
                                <Input
                                    id="image-url"
                                    value={imageUrl}
                                    onChange={(e) =>
                                        setImageUrl(e.target.value)
                                    }
                                    placeholder="https://example.com/scene.jpg"
                                    type="url"
                                />
                                <p className="text-xs text-muted-foreground">
                                    A publicly accessible JPEG, PNG, or WebP.
                                    High-resolution panoramas and wide-angle
                                    shots work best.
                                </p>
                            </div>

                            {/* Panorama toggle */}
                            <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                                <div className="flex-1">
                                    <p className="text-sm font-medium">
                                        Panoramic Image
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Enable if your image is a 360°
                                        equirectangular panorama
                                    </p>
                                </div>
                                <Switch
                                    checked={isPano}
                                    onCheckedChange={setIsPano}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="image-text">
                                    Scene Guidance{' '}
                                    <span className="text-muted-foreground font-normal">
                                        (optional)
                                    </span>
                                </Label>
                                <Textarea
                                    id="image-text"
                                    value={imageText}
                                    onChange={(e) =>
                                        setImageText(e.target.value)
                                    }
                                    rows={3}
                                    placeholder="Additional context about mood, materials, or atmosphere…"
                                    className="resize-none"
                                />
                            </div>
                        </TabsContent>

                        {/* ── Multi-Image ───────────────────────────────────── */}
                        <TabsContent
                            value="multi-image"
                            className="space-y-4 pt-4"
                        >
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>
                                        Reference Images{' '}
                                        <span className="text-muted-foreground font-normal text-xs">
                                            {slots.length}/8
                                        </span>
                                    </Label>
                                    {slots.length < 8 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 gap-1 text-xs cursor-pointer"
                                            onClick={addSlot}
                                        >
                                            <Plus className="h-3 w-3" />
                                            Add Image
                                        </Button>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Multiple views of the same scene. The
                                    azimuth angle (0–360°) indicates the
                                    shooting direction — 0° front, 90° right,
                                    180° back.
                                </p>
                                <div className="space-y-2">
                                    {slots.map((slot, i) => (
                                        <div
                                            key={slot.id}
                                            className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 p-2.5"
                                        >
                                            <div className="h-6 w-6 rounded-md bg-green-500/10 flex items-center justify-center shrink-0">
                                                <span className="text-[10px] font-semibold text-green-500">
                                                    {i + 1}
                                                </span>
                                            </div>
                                            <Input
                                                value={slot.url}
                                                onChange={(e) =>
                                                    updateSlot(
                                                        slot.id,
                                                        'url',
                                                        e.target.value,
                                                    )
                                                }
                                                placeholder={`https://example.com/view-${i + 1}.jpg`}
                                                className="flex-1 h-8 text-sm"
                                            />
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max="360"
                                                    value={slot.azimuth}
                                                    onChange={(e) =>
                                                        updateSlot(
                                                            slot.id,
                                                            'azimuth',
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-18 h-8 text-sm text-center"
                                                    title="Azimuth angle (0–360°)"
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                    °
                                                </span>
                                            </div>
                                            {slots.length > 1 && (
                                                <button
                                                    type="button"
                                                    className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors cursor-pointer shrink-0"
                                                    onClick={() =>
                                                        removeSlot(slot.id)
                                                    }
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="multi-text">
                                    Scene Guidance{' '}
                                    <span className="text-muted-foreground font-normal">
                                        (optional)
                                    </span>
                                </Label>
                                <Textarea
                                    id="multi-text"
                                    value={multiText}
                                    onChange={(e) =>
                                        setMultiText(e.target.value)
                                    }
                                    rows={3}
                                    placeholder="Describe the overall scene, mood, or specific details to emphasize…"
                                    className="resize-none"
                                />
                            </div>
                        </TabsContent>

                        {/* ── Video ─────────────────────────────────────────── */}
                        <TabsContent value="video" className="space-y-4 pt-4">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                                    <Label htmlFor="video-url">Video URL</Label>
                                </div>
                                <Input
                                    id="video-url"
                                    value={videoUrl}
                                    onChange={(e) =>
                                        setVideoUrl(e.target.value)
                                    }
                                    placeholder="https://example.com/walkthrough.mp4"
                                    type="url"
                                />
                                <p className="text-xs text-muted-foreground">
                                    A publicly accessible MP4, MOV, or MKV.
                                    Walking tours and smooth panning footage
                                    work best.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="video-text">
                                    Scene Guidance{' '}
                                    <span className="text-muted-foreground font-normal">
                                        (optional)
                                    </span>
                                </Label>
                                <Textarea
                                    id="video-text"
                                    value={videoText}
                                    onChange={(e) =>
                                        setVideoText(e.target.value)
                                    }
                                    rows={3}
                                    placeholder="Additional context about the scene or desired world style…"
                                    className="resize-none"
                                />
                            </div>
                        </TabsContent>

                        {/* ── Presets ───────────────────────────────────────── */}
                        <TabsContent value="presets" className="pt-4">
                            <div className="space-y-5">
                                {presetCategories.map((cat) => (
                                    <div key={cat}>
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                            {cat}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {PRESETS.filter(
                                                (p) => p.category === cat,
                                            ).map((preset) => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className="text-left rounded-lg border border-border/50 bg-card hover:bg-muted/50 hover:border-green-500/40 transition-all p-3 cursor-pointer group"
                                                    onClick={() =>
                                                        pickPreset(preset)
                                                    }
                                                >
                                                    <p className="text-sm font-medium group-hover:text-green-600 transition-colors">
                                                        {preset.label}
                                                    </p>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                                                        {preset.prompt}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                <p className="text-xs text-muted-foreground/50 text-center pt-1">
                                    Click a preset to load it into the Text
                                    editor
                                </p>
                            </div>
                        </TabsContent>
                    </Tabs>

                    {error && (
                        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-500">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {mode !== 'presets' && (
                        <Button
                            type="submit"
                            className="w-full gap-2 cursor-pointer"
                            disabled={isSubmitDisabled}
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Starting generation…
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    Generate World
                                </>
                            )}
                        </Button>
                    )}
                </form>
            </div>
        </div>
    );
}
