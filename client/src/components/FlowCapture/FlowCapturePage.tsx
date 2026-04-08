import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import mermaid from 'mermaid';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as MonacoNS from 'monaco-editor';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
    ArrowLeft,
    BookOpen,
    Check,
    Code2,
    Copy,
    Download,
    Eye,
    FileText,
    GitBranch,
    Loader2,
    Maximize2,
    Mic,
    MicOff,
    MoreHorizontal,
    Pencil,
    RefreshCw,
    Trash2,
    X,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { APPS } from '@/lib/appRegistry';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';

// ── Constants ──────────────────────────────────────────────────────────────────

const app = APPS.find((a) => a.id === 'flow-capture')!;

const INITIAL_DIAGRAM = 'flowchart TD\n    Start(["Start speaking to begin"])';

const SAMPLE_SCRIPT = `So the user lands on the landing page, right? And from there they can either sign up, or log in if they already have an account.

If they're new — new user — they go through the signup flow. That's like, email, password, and then... yeah, there's an email verification step. They confirm their email, and then they get dropped onto the dashboard.

Now if they're a returning user they just log in and, boom — straight to the dashboard. No extra steps.

From the dashboard they can create a new project or jump back into an existing one. When they create a new project we ask a few things — the name, the type, and a short description — and then we run them through this onboarding checklist.

Inside the project — and this is the main workspace — they can invite team members. That sends an invite email. And they can start adding items. Each item has a status: draft, then in-progress, and then done. When something moves to done, a notification fires to the project owner and whoever's assigned.`;

mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    flowchart: { curve: 'basis', padding: 16 },
    themeVariables: {
        background: '#020617',
        primaryColor: '#6366f1',
        primaryTextColor: '#e2e8f0',
        primaryBorderColor: '#4f46e5',
        lineColor: '#64748b',
        secondaryColor: '#1e293b',
        tertiaryColor: '#1e293b',
    },
});

// ── Monaco Mermaid language registration ───────────────────────────────────────

function registerMermaid(monaco: typeof MonacoNS) {
    if (monaco.languages.getLanguages().some((l) => l.id === 'mermaid')) return;

    monaco.languages.register({ id: 'mermaid' });

    monaco.languages.setMonarchTokensProvider('mermaid', {
        tokenizer: {
            root: [
                [
                    /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|gantt|pie|erDiagram|journey|gitGraph|mindmap|block|quadrantChart|xychart-beta)(?=\s|$)/,
                    'keyword.diagram',
                ],
                [/\b(?:TD|LR|RL|BT|TB|TB)\b/, 'keyword.direction'],
                [/%%.+$/, 'comment'],
                [/-->|==>|-\.->|--o|--x|<-->|===>|~~~|--/, 'operator'],
                [/\[\[.*?\]\]/, 'type'],
                [/\[\(.*?\)\]/, 'type'],
                [/\(\(.*?\)\)/, 'type'],
                [/\{.*?\}/, 'type.decision'],
                [/\[.*?\]/, 'string.rect'],
                [/\(.*?\)/, 'string.round'],
                [/".*?"/, 'string'],
                [/\|.*?\|/, 'string'],
                [/style\s+\w+/, 'keyword.style'],
                [/class\s+\w+/, 'keyword.class'],
                [/subgraph\b/, 'keyword.subgraph'],
                [/end\b/, 'keyword.subgraph'],
                [/[A-Za-z_]\w*/, 'identifier'],
                [/\d+/, 'number'],
            ],
        },
    } as MonacoNS.languages.IMonarchLanguage);

    monaco.editor.defineTheme('mermaid-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            {
                token: 'keyword.diagram',
                foreground: 'c084fc',
                fontStyle: 'bold',
            },
            { token: 'keyword.direction', foreground: 'a78bfa' },
            { token: 'keyword.style', foreground: 'f472b6' },
            { token: 'keyword.class', foreground: 'f472b6' },
            { token: 'keyword.subgraph', foreground: 'fb923c' },
            { token: 'operator', foreground: '94a3b8' },
            { token: 'string.rect', foreground: '86efac' },
            { token: 'string.round', foreground: '6ee7b7' },
            { token: 'string', foreground: 'fde68a' },
            { token: 'type', foreground: 'fbbf24' },
            { token: 'type.decision', foreground: 'fb923c' },
            { token: 'comment', foreground: '475569', fontStyle: 'italic' },
            { token: 'identifier', foreground: 'e2e8f0' },
            { token: 'number', foreground: '60a5fa' },
        ],
        colors: {
            'editor.background': '#020617',
            'editor.lineHighlightBackground': '#0f172a',
            'editorLineNumber.foreground': '#334155',
            'editorLineNumber.activeForeground': '#64748b',
        },
    });
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface Session {
    id: number;
    name: string;
    chunk_count: number;
    created_at: string;
    updated_at: string;
}

interface Chunk {
    id: number;
    session_id: number;
    text: string;
    sequence: number;
    created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FlowCapturePage() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();
    const { trackPageView, trackAction } = useAppTracking('flow-capture');

    const [activeSession, setActiveSession] = useState<Session | null>(null);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const titleInputRef = useRef<HTMLInputElement>(null);

    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [diagram, setDiagram] = useState(INITIAL_DIAGRAM);
    const [renderedSvg, setRenderedSvg] = useState('');
    const [renderError, setRenderError] = useState(false);
    const [diagramStale, setDiagramStale] = useState(false);
    const [diagramView, setDiagramView] = useState<'preview' | 'source'>(
        'preview',
    );
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSavingSource, setIsSavingSource] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showSample, setShowSample] = useState(false);
    const [copied, setCopied] = useState(false);
    const [inputMode, setInputMode] = useState<'voice' | 'text'>('voice');
    const [editingChunk, setEditingChunk] = useState<Chunk | null>(null);
    const [editText, setEditText] = useState('');
    const [textInput, setTextInput] = useState('');
    const [isImporting, setIsImporting] = useState(false);

    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const diagramRef = useRef(INITIAL_DIAGRAM);
    const renderIdRef = useRef(0);
    const sessionIdRef = useRef<number | null>(null);
    const chunksScrollRef = useRef<HTMLDivElement>(null);
    const transformRef = useRef<ReactZoomPanPinchRef>(null);
    // Track the chunk count at the last diagram generation to detect staleness accurately
    const lastGeneratedAtRef = useRef<number>(0);
    // Debounce timer for auto diagram updates
    const autoGenerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    // Voice buffer — accumulates speech finals before AI segmentation
    const [voiceBuffer, setVoiceBuffer] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const voiceBufferRef = useRef('');

    // ── Chunk selection & highlighting ────────────────────────────────────────
    // freshChunkIds: IDs added in the current pending batch (since last diagram gen)
    const [freshChunkIds, setFreshChunkIds] = useState<Set<number>>(new Set());
    const pendingChunkIdsRef = useRef<Set<number>>(new Set());
    // selectedChunkSeq: sequence number of the currently selected card
    const [selectedChunkSeq, setSelectedChunkSeq] = useState<number | null>(
        null,
    );
    // chunkNodeMap: maps sequence (as string key) → mermaid node IDs for diagram highlighting
    const [chunkNodeMap, setChunkNodeMap] = useState<Record<string, string[]>>(
        {},
    );

    // ── Mermaid render — keep last valid SVG on errors ────────────────────────
    // mermaid.render() appends elements to document.body when no container is given —
    // on syntax errors the error SVG leaks into the DOM. Always use a hidden off-screen
    // container so nothing ever touches the visible page, then clean it up afterwards.

    const renderDiagram = useCallback(async (code: string) => {
        const id = ++renderIdRef.current;
        // Off-screen container — mermaid renders here, never touches document.body
        const container = document.createElement('div');
        container.style.cssText =
            'position:absolute;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none';
        document.body.appendChild(container);
        try {
            const elementId = `mermaid-render-${Date.now()}`;
            const { svg } = await mermaid.render(elementId, code, container);
            document.body.removeChild(container);
            // mermaid v11 embeds "Syntax error" text in the SVG on parse failures — discard those
            if (id === renderIdRef.current) {
                if (!svg.includes('Syntax error')) {
                    setRenderedSvg(svg);
                    setRenderError(false);
                } else {
                    setRenderError(true);
                }
            }
        } catch {
            if (document.body.contains(container))
                document.body.removeChild(container);
            if (id === renderIdRef.current) setRenderError(true);
        }
    }, []);

    useEffect(() => {
        renderDiagram(diagram);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagram]);

    // ── Auto-scroll chunks list ────────────────────────────────────────────────

    useEffect(() => {
        const el = chunksScrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [chunks]);

    // ── Session API helpers ────────────────────────────────────────────────────

    const loadSession = useCallback(async (id: number) => {
        try {
            // Reset render state before loading so stale SVG never shows for a new session
            setRenderedSvg('');
            setRenderError(false);
            ++renderIdRef.current; // invalidate any in-flight renders

            const res = await fetch(`/app/api/flow-capture/sessions/${id}`, {
                credentials: 'include',
            });
            if (!res.ok) return;
            const {
                chunks: loadedChunks,
                diagram: loadedDiagram,
                chunkNodeMap: loadedMap,
                ...session
            } = await res.json();
            setActiveSession(session as Session);
            sessionIdRef.current = id;
            setChunks(loadedChunks ?? []);
            lastGeneratedAtRef.current = (loadedChunks ?? []).length;
            setInterimText('');
            setVoiceBuffer('');
            voiceBufferRef.current = '';
            setFreshChunkIds(new Set());
            pendingChunkIdsRef.current = new Set();
            setSelectedChunkSeq(null);
            setChunkNodeMap(loadedMap ?? {});
            const d = loadedDiagram || INITIAL_DIAGRAM;
            setDiagram(d);
            diagramRef.current = d;
            setDiagramStale(false);
        } catch {
            /* silent */
        }
    }, []);

    const deleteSession = useCallback(
        async (id: number) => {
            await fetch(`/app/api/flow-capture/sessions/${id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            navigate('/flow-capture');
        },
        [navigate],
    );

    // ── Init ───────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (sessionId) {
            loadSession(Number(sessionId));
            trackPageView();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, trackPageView]);

    // ── AI title generation ────────────────────────────────────────────────────

    const generateAutoTitle = useCallback(async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        setIsGeneratingTitle(true);
        try {
            const res = await fetch(
                `/app/api/flow-capture/sessions/${sid}/title`,
                {
                    method: 'POST',
                    credentials: 'include',
                },
            );
            if (res.ok) {
                const { name } = await res.json();
                setActiveSession((s) => (s ? { ...s, name } : s));
            }
        } finally {
            setIsGeneratingTitle(false);
        }
    }, []);

    // ── Inline title editing ───────────────────────────────────────────────────

    const saveTitle = useCallback(async () => {
        const sid = sessionIdRef.current;
        const name = titleDraft.trim();
        setIsEditingTitle(false);
        if (!sid || !name) return;
        await fetch(`/app/api/flow-capture/sessions/${sid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name }),
        });
        setActiveSession((s) => (s ? { ...s, name } : s));
        trackAction('flow_title_edited');
    }, [titleDraft, trackAction]);

    // ── AI diagram generation ──────────────────────────────────────────────────

    const generateDiagram = useCallback(
        async (remix = false) => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            setIsProcessing(true);
            setError(null);
            setRenderError(false);
            // Capture and clear the pending batch — these will become "fresh" after generation
            const batchIds = new Set(pendingChunkIdsRef.current);
            pendingChunkIdsRef.current = new Set();
            setSelectedChunkSeq(null);
            try {
                const res = await fetch(
                    `/app/api/flow-capture/sessions/${sid}/diagram`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            currentDiagram: remix
                                ? undefined
                                : diagramRef.current === INITIAL_DIAGRAM
                                  ? undefined
                                  : diagramRef.current,
                            remix,
                        }),
                    },
                );
                if (!res.ok) throw new Error('failed');
                const { diagram: newDiagram, chunkNodeMap: newMap } =
                    await res.json();
                if (newDiagram) {
                    diagramRef.current = newDiagram;
                    setDiagram(newDiagram);
                }
                if (newMap) setChunkNodeMap(newMap);
                // Mark the batch that triggered this generation as "fresh"
                setFreshChunkIds(batchIds);
                setDiagramStale(false);
                setChunks((prev) => {
                    lastGeneratedAtRef.current = prev.length;
                    return prev;
                });
                // Auto-title on first generation if name is still default
                setActiveSession((s) => {
                    if (s && /^Session\s/.test(s.name)) generateAutoTitle();
                    return s;
                });
            } catch {
                // Restore pending IDs so they're not lost on retry
                for (const id of batchIds) pendingChunkIdsRef.current.add(id);
                setDiagramStale(true);
                setError('Diagram update failed — click Retry to try again');
            } finally {
                setIsProcessing(false);
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        },
        [generateAutoTitle],
    );

    // ── Auto-update: debounced diagram regeneration after new chunks ──────────

    const scheduleDiagramUpdate = useCallback(() => {
        if (autoGenerateTimerRef.current)
            clearTimeout(autoGenerateTimerRef.current);
        autoGenerateTimerRef.current = setTimeout(() => {
            generateDiagram(false);
        }, 1500);
    }, [generateDiagram]);

    // ── Save diagram source (manual edits) ────────────────────────────────────

    const saveDiagramSource = useCallback(
        async (code: string) => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            setIsSavingSource(true);
            try {
                await fetch(`/app/api/flow-capture/sessions/${sid}/diagram`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ mermaid: code }),
                });
                diagramRef.current = code;
                setDiagram(code);
                setDiagramStale(false);
                trackAction('diagram_source_edited');
            } finally {
                setIsSavingSource(false);
            }
        },
        [trackAction],
    );

    // ── Chunk persistence ──────────────────────────────────────────────────────

    const saveChunk = useCallback(
        async (text: string) => {
            const sid = sessionIdRef.current;
            if (!sid || !text.trim()) return;
            try {
                const res = await fetch(
                    `/app/api/flow-capture/sessions/${sid}/chunks`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ text }),
                    },
                );
                if (!res.ok) return;
                const chunk: Chunk = await res.json();
                setChunks((prev) => [...prev, chunk]);
                setActiveSession((s) =>
                    s ? { ...s, chunk_count: s.chunk_count + 1 } : s,
                );
                pendingChunkIdsRef.current.add(chunk.id);
                scheduleDiagramUpdate();
            } catch {
                /* silent */
            }
        },
        [scheduleDiagramUpdate],
    );

    const deleteChunk = useCallback(
        async (chunk: Chunk) => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            await fetch(
                `/app/api/flow-capture/sessions/${sid}/chunks/${chunk.id}`,
                {
                    method: 'DELETE',
                    credentials: 'include',
                },
            );
            setChunks((prev) => prev.filter((c) => c.id !== chunk.id));
            setActiveSession((s) =>
                s ? { ...s, chunk_count: Math.max(0, s.chunk_count - 1) } : s,
            );
            trackAction('segment_deleted');
        },
        [trackAction],
    );

    const updateChunk = useCallback(
        async (chunk: Chunk, text: string) => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            await fetch(
                `/app/api/flow-capture/sessions/${sid}/chunks/${chunk.id}`,
                {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text }),
                },
            );
            setChunks((prev) =>
                prev.map((c) => (c.id === chunk.id ? { ...c, text } : c)),
            );
            scheduleDiagramUpdate();
            trackAction('segment_updated');
        },
        [scheduleDiagramUpdate, trackAction],
    );

    // ── Text import ────────────────────────────────────────────────────────────

    const importText = useCallback(async () => {
        const raw = textInput.trim();
        if (!raw) return;
        const paragraphs = raw
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);
        const toSave = paragraphs.length > 1 ? paragraphs : [raw];
        setIsImporting(true);
        try {
            for (const text of toSave) await saveChunk(text);
            setTextInput('');
            trackAction('segment_added', {
                source: 'text',
                count: toSave.length,
            });
        } finally {
            setIsImporting(false);
        }
    }, [textInput, saveChunk, trackAction]);

    // ── Voice buffer analysis ─────────────────────────────────────────────────

    const analyzeBuffer = useCallback(
        async (text: string) => {
            const sid = sessionIdRef.current;
            if (!sid || !text.trim()) return;
            // Skip if too short — not enough context to segment yet
            if (text.trim().split(/\s+/).length < 12) return;

            setIsAnalyzing(true);
            try {
                const res = await fetch(
                    `/app/api/flow-capture/sessions/${sid}/analyze`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ text }),
                    },
                );
                if (!res.ok) return;
                const { complete, remainder } = (await res.json()) as {
                    complete: string[];
                    remainder: string;
                };

                for (const seg of complete) {
                    await saveChunk(seg);
                    trackAction('segment_added', { source: 'voice' });
                }

                if (complete.length > 0) {
                    voiceBufferRef.current = remainder;
                    setVoiceBuffer(remainder);
                }
            } finally {
                setIsAnalyzing(false);
            }
        },
        [saveChunk, trackAction],
    );

    const forceAddBuffer = useCallback(async () => {
        const text = voiceBuffer.trim();
        if (!text) return;
        await saveChunk(text);
        voiceBufferRef.current = '';
        setVoiceBuffer('');
        trackAction('segment_added', { source: 'voice' });
    }, [voiceBuffer, saveChunk, trackAction]);

    // ── Speech recognition ─────────────────────────────────────────────────────

    const startListening = useCallback(() => {
        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError('Speech recognition not supported. Try Chrome or Edge.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            let finalPart = '';
            let interimPart = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const r = event.results[i];
                if (r.isFinal) finalPart += r[0].transcript + ' ';
                else interimPart = r[0].transcript;
            }
            if (finalPart.trim()) {
                setInterimText('');
                const newBuffer = (
                    voiceBufferRef.current +
                    ' ' +
                    finalPart
                ).trim();
                voiceBufferRef.current = newBuffer;
                setVoiceBuffer(newBuffer);
                analyzeBuffer(newBuffer);
            } else {
                setInterimText(interimPart);
            }
        };

        recognition.onerror = (event) => {
            if (event.error !== 'no-speech')
                setError(`Speech error: ${event.error}`);
        };

        recognition.onend = () => {
            if (recognitionRef.current === recognition) {
                try {
                    recognition.start();
                } catch {
                    /* ignore */
                }
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
        setError(null);
    }, [analyzeBuffer]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            const r = recognitionRef.current;
            recognitionRef.current = null;
            r.stop();
        }
        setInterimText('');
        setIsListening(false);
    }, []);

    // ── Monaco setup ───────────────────────────────────────────────────────────

    const handleMonacoMount: OnMount = useCallback(
        (editor, monaco) => {
            registerMermaid(monaco);
            monaco.editor.setTheme('mermaid-dark');
            // Live-render on change (debounced in the effect below via diagram state)
            editor.onDidChangeModelContent(() => {
                const code = editor.getValue();
                diagramRef.current = code;
                renderDiagram(code);
            });
        },
        [renderDiagram],
    );

    // ── Cleanup ────────────────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (recognitionRef.current) recognitionRef.current.stop();
        };
    }, []);

    // ── Misc actions ───────────────────────────────────────────────────────────

    const downloadSvg = useCallback(() => {
        if (!renderedSvg) return;
        const blob = new Blob([renderedSvg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flow-${activeSession?.name ?? 'diagram'}-${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        trackAction('diagram_svg_downloaded', {
            sessionName: activeSession?.name,
        });
    }, [renderedSvg, activeSession, trackAction]);

    const copySample = useCallback(() => {
        navigator.clipboard.writeText(SAMPLE_SCRIPT);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, []);

    const hasContent = chunks.length > 0 || !!voiceBuffer;
    const hasDiagram = renderedSvg && diagram !== INITIAL_DIAGRAM;

    // ── Highlighted SVG — inject CSS for selected chunk's nodes ──────────────
    const highlightedSvg = useMemo(() => {
        if (!renderedSvg || selectedChunkSeq == null) return renderedSvg;
        const nodeIds = chunkNodeMap[selectedChunkSeq] ?? [];
        if (!nodeIds.length) return renderedSvg;
        const styleRules = nodeIds
            .map(
                (id) =>
                    `g[id^="flowchart-${id}-"] rect, g[id^="flowchart-${id}-"] polygon, g[id^="flowchart-${id}-"] circle { fill: rgba(99,102,241,0.28) !important; stroke: #818cf8 !important; stroke-width: 2.5px !important; filter: drop-shadow(0 0 8px rgba(99,102,241,0.45)); }`,
            )
            .join('\n');
        return renderedSvg.replace(
            '</svg>',
            `<style>${styleRules}</style></svg>`,
        );
    }, [renderedSvg, selectedChunkSeq, chunkNodeMap]);

    // ── Render ─────────────────────────────────────────────────────────────────

    // Editable title node
    const editableTitle = (
        <div className="flex items-center gap-1.5">
            {isEditingTitle ? (
                <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') titleInputRef.current?.blur();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                    }}
                    className="text-xs bg-transparent border-b border-primary/60 outline-none text-foreground w-48"
                    autoFocus
                />
            ) : (
                <button
                    onClick={() => {
                        setTitleDraft(activeSession?.name ?? '');
                        setIsEditingTitle(true);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer group flex items-center gap-1"
                    title="Click to rename"
                >
                    <span>{activeSession?.name ?? '…'}</span>
                    <Pencil
                        size={9}
                        className="opacity-0 group-hover:opacity-60 transition-opacity"
                    />
                </button>
            )}
            {isGeneratingTitle && (
                <Loader2
                    size={9}
                    className="animate-spin text-muted-foreground"
                />
            )}
        </div>
    );

    return (
        <>
            <AppLayout
                icon={<app.icon size={20} />}
                iconClassName={app.color}
                title={app.name}
                subtitle={editableTitle}
                actions={
                    <div className="flex items-center gap-1.5">
                        {/* Back to sessions list */}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate('/flow-capture')}
                            className="text-muted-foreground hover:text-foreground gap-1.5 cursor-pointer"
                        >
                            <ArrowLeft size={13} />
                            Sessions
                        </Button>

                        {/* More menu */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground cursor-pointer"
                                >
                                    <MoreHorizontal size={15} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() => setShowSample(true)}
                                >
                                    <BookOpen size={14} className="mr-2" />
                                    Sample script
                                </DropdownMenuItem>
                                {activeSession && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="cursor-pointer text-destructive focus:text-destructive"
                                            onClick={() =>
                                                deleteSession(activeSession.id)
                                            }
                                        >
                                            <Trash2
                                                size={14}
                                                className="mr-2"
                                            />
                                            Delete session
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                }
            >
                <div className="flex h-full overflow-hidden">
                    {/* ── Left: Transcript panel ──────────────────────────────────── */}
                    <div className="w-72 shrink-0 flex flex-col border-r min-h-0 overflow-hidden">
                        {/* Panel header — full-width tabs */}
                        <div className="flex">
                            <button
                                onClick={() => setInputMode('voice')}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 ${
                                    inputMode === 'voice'
                                        ? 'border-primary text-foreground bg-background'
                                        : 'border-transparent text-muted-foreground hover:text-foreground bg-muted/30'
                                }`}
                            >
                                {isListening ? (
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                                    </span>
                                ) : (
                                    <Mic size={12} />
                                )}
                                Voice
                                {inputMode === 'voice' && chunks.length > 0 && (
                                    <Badge
                                        variant="secondary"
                                        className="text-[10px] tabular-nums h-4 px-1.5"
                                    >
                                        {chunks.length}
                                    </Badge>
                                )}
                            </button>
                            <button
                                onClick={() => {
                                    setInputMode('text');
                                    if (isListening) stopListening();
                                }}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 ${
                                    inputMode === 'text'
                                        ? 'border-primary text-foreground bg-background'
                                        : 'border-transparent text-muted-foreground hover:text-foreground bg-muted/30'
                                }`}
                            >
                                <FileText size={12} />
                                Text
                                {inputMode === 'text' && chunks.length > 0 && (
                                    <Badge
                                        variant="secondary"
                                        className="text-[10px] tabular-nums h-4 px-1.5"
                                    >
                                        {chunks.length}
                                    </Badge>
                                )}
                            </button>
                        </div>

                        {/* Chunks — scrollable region */}
                        <div
                            ref={chunksScrollRef}
                            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                        >
                            <div className="p-3 space-y-2">
                                {/* Empty state */}
                                {!hasContent && (
                                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-2">
                                        <div className="rounded-full bg-muted p-3">
                                            {inputMode === 'text' ? (
                                                <FileText
                                                    size={20}
                                                    className="text-muted-foreground"
                                                />
                                            ) : (
                                                <Mic
                                                    size={20}
                                                    className="text-muted-foreground"
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-foreground">
                                                No segments yet
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                                {inputMode === 'text'
                                                    ? 'Paste or type a flow description below. Blank lines split it into segments.'
                                                    : isListening
                                                      ? 'Listening… speak naturally. Each pause saves a segment.'
                                                      : 'Hit Record below and describe your flow in plain language.'}
                                            </p>
                                        </div>
                                        {inputMode === 'voice' &&
                                            !isListening && (
                                                <button
                                                    onClick={() =>
                                                        setShowSample(true)
                                                    }
                                                    className="text-xs text-primary underline underline-offset-2 cursor-pointer hover:opacity-80 transition-opacity"
                                                >
                                                    Try a sample script →
                                                </button>
                                            )}
                                        {inputMode === 'voice' &&
                                            isListening && (
                                                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                                                    Complete ideas are extracted
                                                    automatically — fragments
                                                    stay in the input below.
                                                </p>
                                            )}
                                    </div>
                                )}

                                {/* Persisted chunks */}
                                {chunks.map((chunk) => {
                                    const isFresh = freshChunkIds.has(chunk.id);
                                    const isSelected =
                                        selectedChunkSeq === chunk.sequence;
                                    return (
                                        <div
                                            key={chunk.id}
                                            onClick={() =>
                                                setSelectedChunkSeq(
                                                    isSelected
                                                        ? null
                                                        : chunk.sequence,
                                                )
                                            }
                                            className={`group relative rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-all duration-200 ${
                                                isSelected
                                                    ? 'border-violet-500/70 bg-violet-500/10 ring-1 ring-violet-500/30 shadow-[0_0_14px_rgba(99,102,241,0.18)]'
                                                    : isFresh
                                                      ? 'border-violet-500/40 bg-violet-500/5 hover:border-violet-500/60 hover:bg-violet-500/10'
                                                      : 'bg-card hover:border-border/80 hover:bg-muted/30'
                                            }`}
                                        >
                                            {/* Fresh indicator dot */}
                                            {isFresh && !isSelected && (
                                                <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-violet-500 opacity-70" />
                                            )}
                                            <div className="flex items-center justify-between gap-1 mb-1.5">
                                                <span
                                                    className={`text-[10px] font-mono uppercase tracking-wider ${
                                                        isSelected
                                                            ? 'text-violet-400/80'
                                                            : 'text-muted-foreground/60'
                                                    }`}
                                                >
                                                    #{chunk.sequence} ·{' '}
                                                    {formatTime(
                                                        chunk.created_at,
                                                    )}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingChunk(
                                                                chunk,
                                                            );
                                                            setEditText(
                                                                chunk.text,
                                                            );
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
                                                        title="Edit segment"
                                                    >
                                                        <Pencil size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            deleteChunk(chunk);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
                                                        title="Remove segment"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                            <p
                                                className={`leading-relaxed ${isSelected ? 'text-foreground' : 'text-foreground/90'}`}
                                            >
                                                {chunk.text}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20 flex items-center justify-between gap-2">
                                <span>{error}</span>
                                <button
                                    onClick={() => setError(null)}
                                    className="shrink-0 cursor-pointer hover:opacity-70"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}

                        {/* Bottom input area */}
                        <div className="border-t bg-muted/20">
                            {inputMode === 'voice' ? (
                                <div className="p-3 flex flex-col gap-2">
                                    {/* Live buffer — shown when there's accumulated speech */}
                                    {(voiceBuffer || interimText) && (
                                        <div className="space-y-1">
                                            <div className="relative">
                                                <Textarea
                                                    value={voiceBuffer}
                                                    onChange={(e) => {
                                                        voiceBufferRef.current =
                                                            e.target.value;
                                                        setVoiceBuffer(
                                                            e.target.value,
                                                        );
                                                    }}
                                                    placeholder="Accumulated speech…"
                                                    className="resize-none text-sm min-h-[72px] bg-background pr-8"
                                                />
                                                {isAnalyzing && (
                                                    <Loader2
                                                        size={11}
                                                        className="animate-spin absolute top-2 right-2 text-muted-foreground/50"
                                                    />
                                                )}
                                            </div>
                                            {interimText && (
                                                <p className="text-[11px] text-muted-foreground/50 italic px-1 leading-relaxed truncate">
                                                    {interimText}…
                                                </p>
                                            )}
                                            {voiceBuffer.trim() && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full gap-1.5 h-7 text-xs cursor-pointer"
                                                    onClick={forceAddBuffer}
                                                    title="Add current buffer as a segment now"
                                                >
                                                    <Check size={11} />
                                                    Add as segment
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                    <Button
                                        className="w-full gap-2"
                                        size="default"
                                        variant={
                                            isListening
                                                ? 'destructive'
                                                : 'default'
                                        }
                                        onClick={
                                            isListening
                                                ? stopListening
                                                : startListening
                                        }
                                    >
                                        {isListening ? (
                                            <>
                                                <MicOff size={15} />
                                                Stop Recording
                                            </>
                                        ) : (
                                            <>
                                                <Mic size={15} />
                                                Start Recording
                                            </>
                                        )}
                                    </Button>
                                </div>
                            ) : (
                                <div className="p-3 flex flex-col gap-2">
                                    <Textarea
                                        value={textInput}
                                        onChange={(e) =>
                                            setTextInput(e.target.value)
                                        }
                                        placeholder="Paste or type a flow description…&#10;&#10;Separate paragraphs with a blank line — each becomes its own segment."
                                        className="resize-none text-sm min-h-[96px] bg-background"
                                        onKeyDown={(e) => {
                                            if (
                                                (e.ctrlKey || e.metaKey) &&
                                                e.key === 'Enter'
                                            ) {
                                                e.preventDefault();
                                                importText();
                                            }
                                        }}
                                    />
                                    <Button
                                        className="w-full gap-2"
                                        size="default"
                                        disabled={
                                            !textInput.trim() || isImporting
                                        }
                                        onClick={importText}
                                    >
                                        {isImporting ? (
                                            <>
                                                <Loader2
                                                    size={15}
                                                    className="animate-spin"
                                                />
                                                Importing…
                                            </>
                                        ) : (
                                            <>
                                                <FileText size={15} />
                                                Add to Flow
                                            </>
                                        )}
                                    </Button>
                                    <p className="text-[10px] text-muted-foreground text-center">
                                        ⌘↵ to submit · blank lines split into
                                        segments
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Right: Diagram panel ────────────────────────────────────── */}
                    <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">
                        {/* Diagram canvas — Preview or Source */}
                        <div className="flex-1 min-h-0 overflow-hidden relative">
                            {diagramView === 'preview' ? (
                                hasDiagram ? (
                                    <>
                                        <TransformWrapper
                                            ref={transformRef}
                                            initialScale={1}
                                            minScale={0.2}
                                            maxScale={4}
                                            centerOnInit
                                            wheel={{ step: 0.1 }}
                                            onZoomStop={() =>
                                                trackAction('diagram_zoom')
                                            }
                                            onPanningStop={() =>
                                                trackAction('diagram_pan')
                                            }
                                        >
                                            <TransformComponent
                                                wrapperStyle={{
                                                    width: '100%',
                                                    height: '100%',
                                                }}
                                                contentStyle={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    padding: '2rem',
                                                }}
                                            >
                                                <div
                                                    className="mermaid-output"
                                                    // eslint-disable-next-line react/no-danger
                                                    dangerouslySetInnerHTML={{
                                                        __html: highlightedSvg,
                                                    }}
                                                />
                                            </TransformComponent>
                                        </TransformWrapper>
                                        {/* Render error overlay — diagram exists but latest update had errors */}
                                        {renderError && !isProcessing && (
                                            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-2.5 bg-amber-950/90 border border-amber-500/30 text-amber-300 text-xs rounded-lg px-3.5 py-2 shadow-lg backdrop-blur-sm">
                                                <span className="text-amber-400/80">
                                                    ⚠
                                                </span>
                                                <span>
                                                    Latest diagram has errors —
                                                    showing previous version
                                                </span>
                                                <button
                                                    onClick={() =>
                                                        generateDiagram(true)
                                                    }
                                                    className="ml-1 underline underline-offset-2 hover:text-amber-200 cursor-pointer transition-colors"
                                                >
                                                    Remix
                                                </button>
                                            </div>
                                        )}
                                    </>
                                ) : renderError && !isProcessing ? (
                                    /* No valid diagram yet, but render failed */
                                    <div className="flex h-full items-center justify-center">
                                        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
                                            <div className="rounded-2xl bg-amber-500/10 p-5">
                                                <RefreshCw
                                                    size={32}
                                                    className="text-amber-400/60"
                                                />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white/60">
                                                    Couldn't render this diagram
                                                </p>
                                                <p className="text-xs text-white/30 mt-1.5 leading-relaxed">
                                                    The AI generated something
                                                    it couldn't display. Try
                                                    regenerating.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() =>
                                                    generateDiagram(true)
                                                }
                                                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors cursor-pointer underline underline-offset-2"
                                            >
                                                <RefreshCw size={12} />
                                                Regenerate diagram
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
                                            <div className="rounded-2xl bg-white/5 p-5">
                                                <GitBranch
                                                    size={36}
                                                    className="text-white/20"
                                                />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white/40">
                                                    Your diagram will appear
                                                    here
                                                </p>
                                                <p className="text-xs text-white/25 mt-1.5 leading-relaxed">
                                                    Add segments and the diagram
                                                    will update automatically.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )
                            ) : (
                                /* Source view — Monaco editor */
                                <div className="h-full w-full">
                                    <Editor
                                        height="100%"
                                        language="mermaid"
                                        value={diagram}
                                        theme="mermaid-dark"
                                        onMount={handleMonacoMount}
                                        options={{
                                            fontSize: 13,
                                            fontFamily:
                                                'JetBrains Mono, Fira Code, monospace',
                                            minimap: { enabled: false },
                                            lineNumbers: 'on',
                                            wordWrap: 'on',
                                            scrollBeyondLastLine: false,
                                            padding: { top: 16, bottom: 16 },
                                            renderLineHighlight: 'line',
                                            smoothScrolling: true,
                                            cursorBlinking: 'smooth',
                                            bracketPairColorization: {
                                                enabled: false,
                                            },
                                            folding: false,
                                            automaticLayout: true,
                                        }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Diagram footer bar */}
                        <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 bg-slate-950 gap-2">
                            {/* Left: status */}
                            <div className="flex items-center gap-2 min-w-0">
                                {isProcessing ? (
                                    <div className="flex items-center gap-1.5 text-xs text-white/40">
                                        <Loader2
                                            size={11}
                                            className="animate-spin"
                                        />
                                        <span>Updating diagram…</span>
                                    </div>
                                ) : diagramStale && hasContent ? (
                                    <div className="flex items-center gap-1.5 text-xs text-amber-400/70">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400/70 shrink-0" />
                                        <span>
                                            New segments — diagram is stale
                                        </span>
                                    </div>
                                ) : hasDiagram ? (
                                    <div className="flex items-center gap-1.5 text-xs text-white/30">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 shrink-0" />
                                        <span>Up to date · Mermaid</span>
                                    </div>
                                ) : (
                                    <span className="text-xs text-white/20">
                                        Mermaid · AI generated
                                    </span>
                                )}
                            </div>

                            {/* Right: actions */}
                            <div className="flex items-center gap-1 shrink-0">
                                {/* View toggle */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 px-2.5 text-xs gap-1.5 transition-colors ${
                                        diagramView === 'preview'
                                            ? 'text-white/70 bg-white/10'
                                            : 'text-white/40 hover:text-white/70 hover:bg-white/10'
                                    }`}
                                    onClick={() => setDiagramView('preview')}
                                    title="Visual preview"
                                >
                                    <Eye size={12} />
                                    Preview
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 px-2.5 text-xs gap-1.5 transition-colors ${
                                        diagramView === 'source'
                                            ? 'text-white/70 bg-white/10'
                                            : 'text-white/40 hover:text-white/70 hover:bg-white/10'
                                    }`}
                                    onClick={() => setDiagramView('source')}
                                    title="Edit Mermaid source"
                                >
                                    <Code2 size={12} />
                                    Source
                                </Button>

                                {/* Divider */}
                                <div className="w-px h-4 bg-white/10 mx-0.5" />

                                {/* Zoom controls — preview only */}
                                {diagramView === 'preview' && hasDiagram && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-white/40 hover:text-white/80 hover:bg-white/10"
                                            onClick={() =>
                                                transformRef.current?.zoomIn()
                                            }
                                            title="Zoom in"
                                        >
                                            <ZoomIn size={13} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-white/40 hover:text-white/80 hover:bg-white/10"
                                            onClick={() =>
                                                transformRef.current?.zoomOut()
                                            }
                                            title="Zoom out"
                                        >
                                            <ZoomOut size={13} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-white/40 hover:text-white/80 hover:bg-white/10"
                                            onClick={() =>
                                                transformRef.current?.resetTransform()
                                            }
                                            title="Reset zoom & pan"
                                        >
                                            <Maximize2 size={11} />
                                        </Button>
                                    </>
                                )}

                                {/* Save source — source view only */}
                                {diagramView === 'source' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2.5 text-xs gap-1.5 text-white/40 hover:text-white/80 hover:bg-white/10"
                                        onClick={() =>
                                            saveDiagramSource(
                                                diagramRef.current,
                                            )
                                        }
                                        disabled={isSavingSource}
                                        title="Save source to session"
                                    >
                                        {isSavingSource ? (
                                            <Loader2
                                                size={11}
                                                className="animate-spin"
                                            />
                                        ) : (
                                            <Check size={12} />
                                        )}
                                        Save
                                    </Button>
                                )}

                                {/* Divider */}
                                <div className="w-px h-4 bg-white/10 mx-0.5" />

                                {/* Regenerate — always visible when there's content */}
                                {hasContent && !isProcessing && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className={`h-7 px-2.5 text-xs gap-1.5 transition-colors ${
                                            diagramStale
                                                ? 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/10'
                                                : 'text-white/40 hover:text-white/80 hover:bg-white/10'
                                        }`}
                                        onClick={() =>
                                            generateDiagram(
                                                diagramStale ? false : true,
                                            )
                                        }
                                        title={
                                            diagramStale
                                                ? 'Retry diagram update'
                                                : 'Remix — regenerate fresh from scratch'
                                        }
                                    >
                                        <RefreshCw size={12} />
                                        {diagramStale ? 'Retry' : 'Remix'}
                                    </Button>
                                )}

                                {/* Export */}
                                {renderedSvg && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2.5 text-xs gap-1.5 text-white/40 hover:text-white/80 hover:bg-white/10"
                                        onClick={downloadSvg}
                                        title="Export as SVG"
                                    >
                                        <Download size={12} />
                                        SVG
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </AppLayout>

            {/* Edit segment dialog */}
            <Dialog
                open={!!editingChunk}
                onOpenChange={(open) => {
                    if (!open) setEditingChunk(null);
                }}
            >
                <DialogContent className="max-w-lg [&>button]:cursor-pointer">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil size={15} />
                            Edit Segment
                            {editingChunk && (
                                <span className="text-xs font-normal text-muted-foreground ml-1">
                                    #{editingChunk.sequence} ·{' '}
                                    {formatTime(editingChunk.created_at)}
                                </span>
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            Edit the segment text below. Changes mark the
                            diagram as stale.
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="min-h-[140px] resize-none text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                e.preventDefault();
                                if (editingChunk && editText.trim()) {
                                    updateChunk(editingChunk, editText.trim());
                                    setEditingChunk(null);
                                }
                            }
                        }}
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button
                            variant="ghost"
                            onClick={() => setEditingChunk(null)}
                            className="cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (editingChunk && editText.trim()) {
                                    updateChunk(editingChunk, editText.trim());
                                    setEditingChunk(null);
                                }
                            }}
                            disabled={
                                !editText.trim() ||
                                editText.trim() === editingChunk?.text
                            }
                            className="cursor-pointer"
                        >
                            <Check size={14} />
                            Save
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Sample script dialog */}
            <Dialog open={showSample} onOpenChange={setShowSample}>
                <DialogContent className="max-w-xl [&>button]:cursor-pointer">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <BookOpen size={16} className="text-purple-400" />
                            Sample Script — read this aloud
                        </DialogTitle>
                        <DialogDescription>
                            A realistic user-flow walkthrough. Hit{' '}
                            <strong>Start Recording</strong> first, then read at
                            a natural pace. Pauses between sentences become
                            separate segments.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="relative mt-1">
                        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground bg-muted/40 rounded-lg p-4 border font-sans">
                            {SAMPLE_SCRIPT}
                        </pre>
                        <Button
                            size="icon"
                            variant="outline"
                            className="absolute top-2 right-2 h-7 w-7 cursor-pointer"
                            onClick={copySample}
                            title={copied ? 'Copied!' : 'Copy script'}
                        >
                            {copied ? (
                                <Check size={13} className="text-green-500" />
                            ) : (
                                <Copy size={13} />
                            )}
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground pt-1">
                        💡 Speak naturally — complete ideas are auto-segmented,
                        and the diagram updates live as you go.
                    </p>

                    <div className="flex items-center gap-2 pt-1">
                        <Button
                            className="flex-1 gap-2 cursor-pointer"
                            onClick={() => {
                                setShowSample(false);
                                setInputMode('voice');
                                if (!isListening) startListening();
                            }}
                        >
                            <Mic size={14} />
                            Start Recording
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShowSample(false)}
                            className="cursor-pointer"
                        >
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
