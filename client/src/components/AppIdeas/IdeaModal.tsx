import { useState, useEffect } from 'react';
import { X, Plus, Trash2, AlertTriangle } from 'lucide-react';

import { STAGE_META, type AppIdea, type Stage } from './types';

interface Props {
    idea?: AppIdea | null;
    onSave: (data: Partial<AppIdea>) => void;
    onClose: () => void;
}

const ALL_STAGES = Object.keys(STAGE_META) as Stage[];

export default function IdeaModal({ idea, onSave, onClose }: Props) {
    const [name, setName] = useState(idea?.name ?? '');
    const [description, setDescription] = useState(idea?.description ?? '');
    const [stage, setStage] = useState<Stage>(idea?.stage ?? 'idea');
    const [group, setGroup] = useState(idea?.group_name ?? '');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>(idea?.tags ?? []);
    const [shaking, setShaking] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    // Compute dirty state: has anything changed from the original?
    const isDirty = idea
        ? name !== (idea.name ?? '') ||
          description !== (idea.description ?? '') ||
          stage !== idea.stage ||
          group !== (idea.group_name ?? '') ||
          JSON.stringify(tags) !== JSON.stringify(idea.tags ?? [])
        : name.trim() !== '' ||
          description.trim() !== '' ||
          tags.length > 0 ||
          group.trim() !== '';

    const triggerShake = () => {
        setShaking(false);
        // Force reflow so re-adding the class triggers the animation again
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setShaking(true));
        });
        setTimeout(() => setShaking(false), 460);
    };

    const tryClose = () => {
        if (isDirty) {
            triggerShake();
            setShowConfirm(true);
        } else {
            onClose();
        }
    };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showConfirm) {
                    setShowConfirm(false);
                } else {
                    tryClose();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose, showConfirm, isDirty]);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) tryClose();
    };

    const addTag = () => {
        const t = tagInput.trim().toLowerCase();
        if (t && !tags.includes(t)) setTags([...tags, t]);
        setTagInput('');
    };

    const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
            name: name.trim(),
            description: description.trim() || null,
            stage,
            tags,
            group_name: group.trim() || null,
        });
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div
                className={`w-full max-w-md bg-card rounded-2xl border shadow-2xl transition-colors ${
                    showConfirm ? 'border-destructive/50' : 'border-border'
                } ${shaking ? 'modal-shake' : ''}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
                    <h2 className="font-semibold text-base">
                        {idea ? 'Edit idea' : 'New idea'}
                    </h2>
                    <button
                        onClick={tryClose}
                        className="cursor-pointer p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
                    {/* Name */}
                    <div>
                        <label
                            htmlFor="idea-name"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block"
                        >
                            Name
                        </label>
                        <input
                            id="idea-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="App name..."
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label
                            htmlFor="idea-description"
                            className="block text-sm font-medium text-gray-400 mb-1"
                        >
                            Description
                        </label>
                        <textarea
                            id="idea-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What does it do? Why build it?"
                            rows={3}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 resize-none"
                        />
                    </div>

                    {/* Stage */}
                    <div>
                        <span
                            id="stage-label"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block"
                        >
                            Stage
                        </span>
                        <div
                            role="group"
                            aria-labelledby="stage-label"
                            className="flex flex-wrap gap-2"
                        >
                            {ALL_STAGES.map((s) => {
                                const m = STAGE_META[s];
                                return (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setStage(s)}
                                        className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                            stage === s
                                                ? `${m.bg} ${m.color} ${m.border}`
                                                : 'border-border text-muted-foreground hover:border-border/80'
                                        }`}
                                    >
                                        <span
                                            className="w-1.5 h-1.5 rounded-full"
                                            style={{ background: m.dot }}
                                        />
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Group */}
                    <div>
                        <label
                            htmlFor="idea-group"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block"
                        >
                            Group
                        </label>
                        <input
                            id="idea-group"
                            value={group}
                            onChange={(e) => setGroup(e.target.value)}
                            placeholder="e.g. Productivity, Finance, CRM..."
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                        />
                    </div>

                    {/* Tags */}
                    <div>
                        <span
                            id="tags-label"
                            className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block"
                        >
                            Tags
                        </span>
                        <div className="flex gap-2 mb-2">
                            <input
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addTag();
                                    }
                                }}
                                placeholder="Add tag..."
                                className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                className="cursor-pointer px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {tags.map((t) => (
                                    <span
                                        key={t}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-xs text-foreground"
                                    >
                                        {t}
                                        <button
                                            type="button"
                                            onClick={() => removeTag(t)}
                                            className="cursor-pointer hover:text-destructive transition-colors"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={tryClose}
                            className="cursor-pointer flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="cursor-pointer flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            {idea ? 'Save changes' : 'Add idea'}
                        </button>
                    </div>
                </form>

                {/* Unsaved changes confirmation bar */}
                {showConfirm && (
                    <div className="px-5 py-3 border-t border-destructive/30 bg-destructive/10 rounded-b-2xl flex items-center gap-3">
                        <AlertTriangle
                            size={14}
                            className="text-destructive shrink-0"
                        />
                        <span className="text-sm text-destructive flex-1">
                            Unsaved changes — discard them?
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowConfirm(false)}
                            className="cursor-pointer px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                        >
                            Keep editing
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="cursor-pointer px-3 py-1 rounded-md text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors"
                        >
                            Discard
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
