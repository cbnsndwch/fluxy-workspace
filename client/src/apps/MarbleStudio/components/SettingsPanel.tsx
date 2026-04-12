import {
    Settings,
    KeyRound,
    CheckCircle2,
    AlertCircle,
    Eye,
    EyeOff,
    Loader2,
    Trash2
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { ApiKeyStatus } from '../types';

interface SettingsPanelProps {
    onSaved: () => void;
}

export function SettingsPanel({ onSaved }: SettingsPanelProps) {
    const [status, setStatus] = useState<ApiKeyStatus>({
        hasKey: false,
        keyHint: null
    });
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [inputKey, setInputKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        fetch('/app/api/marble-studio/settings')
            .then(r => r.json())
            .then((d: ApiKeyStatus) => setStatus(d))
            .finally(() => setLoadingStatus(false));
    }, []);

    const handleSave = async () => {
        if (!inputKey.trim()) return;
        setSaving(true);
        setError('');
        setSaved(false);
        try {
            const res = await fetch('/app/api/marble-studio/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: inputKey.trim() })
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Failed to save');
                return;
            }
            setStatus({ hasKey: true, keyHint: data.keyHint });
            setInputKey('');
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async () => {
        setRemoving(true);
        setError('');
        try {
            await fetch('/app/api/marble-studio/settings', {
                method: 'DELETE'
            });
            setStatus({ hasKey: false, keyHint: null });
            setInputKey('');
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setRemoving(false);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="max-w-xl mx-auto px-8 py-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="h-9 w-9 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <Settings className="h-4.5 w-4.5 text-green-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">
                            Marble Studio Settings
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Configure your World Labs API access
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-border/50">
                        <div className="flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">API Key</h3>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Get your key from{' '}
                            <a
                                href="https://worldlabs.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-2 hover:text-foreground"
                            >
                                worldlabs.ai
                            </a>
                            . Stored locally in your workspace database and
                            never leaves your server.
                        </p>
                    </div>

                    <div className="px-5 py-5 space-y-4">
                        {loadingStatus ? (
                            <div className="h-8 bg-muted animate-pulse rounded-md" />
                        ) : status.hasKey ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 rounded-lg bg-green-500/5 border border-green-500/20 px-4 py-3">
                                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-muted-foreground">
                                            Active key
                                        </p>
                                        <p className="text-sm font-mono font-medium tracking-wider">
                                            {status.keyHint}
                                        </p>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    To replace your key, paste a new one below
                                    and save.
                                </p>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-4 py-3 text-sm text-amber-600">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>
                                    No API key configured — world generation is
                                    disabled.
                                </span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="api-key-input">
                                {status.hasKey
                                    ? 'Replace Key'
                                    : 'Enter API Key'}
                            </Label>
                            <div className="relative">
                                <Input
                                    id="api-key-input"
                                    type={showKey ? 'text' : 'password'}
                                    value={inputKey}
                                    onChange={e => setInputKey(e.target.value)}
                                    placeholder="wlt_..."
                                    className="pr-10 font-mono text-sm"
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleSave();
                                    }}
                                />
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                    onClick={() => setShowKey(v => !v)}
                                    tabIndex={-1}
                                >
                                    {showKey ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-500">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        {saved && (
                            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                API key saved successfully.
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleSave}
                                disabled={saving || !inputKey.trim()}
                                className="gap-2 cursor-pointer"
                                size="sm"
                            >
                                {saving ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <KeyRound className="h-3.5 w-3.5" />
                                )}
                                {status.hasKey ? 'Replace Key' : 'Save Key'}
                            </Button>
                            {status.hasKey && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                                    onClick={handleRemove}
                                    disabled={removing}
                                >
                                    {removing ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    Remove Key
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
