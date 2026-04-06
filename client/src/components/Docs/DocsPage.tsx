import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    ChevronDown,
    ChevronRight,
    Edit3,
    File,
    FilePlus,
    Folder,
    FolderPlus,
    Home,
    Save,
    Trash2,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────
interface TreeNode {
    name: string;
    /** Custom display label from meta.json — falls back to name if absent */
    title?: string;
    /** Whether this folder starts expanded. Defaults to depth < 1 if unset. */
    defaultOpen?: boolean;
    path: string;
    type: 'file' | 'folder';
    children?: TreeNode[];
}

interface TocItem {
    level: number;
    text: string;
    id: string;
}

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader(): Promise<TreeNode[]> {
    const res = await fetch('/app/api/docs/tree');
    return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function extractToc(markdown: string): TocItem[] {
    const lines = markdown.split('\n');
    const items: TocItem[] = [];
    for (const line of lines) {
        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match) {
            const text = match[2].trim();
            const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
            items.push({ level: match[1].length, text, id });
        }
    }
    return items;
}

function slugify(text: string) {
    return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

// ── Tree Node ──────────────────────────────────────────────────────────────────
function TreeItem({ node, selected, onSelect, depth = 0 }: {
    node: TreeNode;
    selected: string | null;
    onSelect: (path: string) => void;
    depth?: number;
}) {
    const [open, setOpen] = useState(node.defaultOpen ?? (depth < 1));

    if (node.type === 'folder') {
        return (
            <div>
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40 rounded transition-colors cursor-pointer"
                    style={{ paddingLeft: `${8 + depth * 12}px` }}
                >
                    {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <Folder className="h-3 w-3 shrink-0 text-amber-500/70" />
                    <span className="truncate font-medium">{node.title ?? node.name}</span>
                </button>
                {open && node.children?.map(child => (
                    <TreeItem key={child.path} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
                ))}
            </div>
        );
    }

    const isActive = selected === node.path || selected === node.path.replace(/\.mdx?$/, '');
    return (
        <button
            onClick={() => onSelect(node.path)}
            className={cn(
                'flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors cursor-pointer',
                isActive
                    ? 'bg-sidebar-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40'
            )}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
            <File className="h-3 w-3 shrink-0" />
            <span className="truncate">{node.name.replace(/\.mdx?$/, '')}</span>
        </button>
    );
}

// ── New File/Folder Dialog ─────────────────────────────────────────────────────
function NewItemDialog({ type, onClose, onCreate }: {
    type: 'file' | 'folder';
    onClose: () => void;
    onCreate: (name: string) => void;
}) {
    const [name, setName] = useState('');
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader><DialogTitle>New {type}</DialogTitle></DialogHeader>
                <Input
                    autoFocus
                    placeholder={type === 'file' ? 'filename.md' : 'folder-name'}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && name.trim() && onCreate(name.trim())}
                />
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => onCreate(name.trim())} disabled={!name.trim()}>Create</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────
function DeleteConfirm({ path, onClose, onDeleted }: { path: string; onClose: () => void; onDeleted: () => void }) {
    const [deleting, setDeleting] = useState(false);
    const name = path.split('/').pop() ?? path;
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader><DialogTitle>Delete file?</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground"><code className="text-xs bg-muted px-1 py-0.5 rounded">{name}</code> will be permanently deleted.</p>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
                    <Button variant="destructive" disabled={deleting} onClick={async () => {
                        setDeleting(true);
                        await fetch(`/app/api/docs/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
                        onDeleted();
                    }}>Delete</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Markdown Renderer ──────────────────────────────────────────────────────────
function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="text-sm leading-relaxed text-muted-foreground space-y-4">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({ children }) => (
                        <h1 id={slugify(String(children))} className="text-2xl font-semibold text-foreground tracking-tight mb-6 pb-3 border-b border-border/50 mt-0">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 id={slugify(String(children))} className="text-lg font-semibold text-foreground tracking-tight mt-8 mb-3">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 id={slugify(String(children))} className="text-base font-semibold text-foreground mt-6 mb-2">
                            {children}
                        </h3>
                    ),
                    p: ({ children }) => <p className="leading-7 text-muted-foreground my-3">{children}</p>,
                    a: ({ href, children }) => (
                        <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                            className="text-primary hover:underline">
                            {children}
                        </a>
                    ),
                    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    ul: ({ children }) => <ul className="list-disc list-outside ml-5 space-y-1 my-3">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-outside ml-5 space-y-1 my-3">{children}</ol>,
                    li: ({ children }) => <li className="leading-6">{children}</li>,
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-primary/40 pl-4 my-4 text-muted-foreground/70 italic">
                            {children}
                        </blockquote>
                    ),
                    hr: () => <hr className="border-border/50 my-6" />,
                    pre: ({ children }) => (
                        <pre className="bg-muted border border-border/50 rounded-lg p-4 overflow-x-auto text-xs font-mono my-4">
                            {children}
                        </pre>
                    ),
                    code: ({ className, children, ...props }) => {
                        const isBlock = className?.includes('language-');
                        return isBlock
                            ? <code className={cn('text-xs font-mono', className)} {...props}>{children}</code>
                            : <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-foreground" {...props}>{children}</code>;
                    },
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="w-full border-collapse text-sm">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => <thead className="border-b border-border/50">{children}</thead>,
                    th: ({ children }) => <th className="px-3 py-2 text-left font-medium text-foreground border border-border/30 bg-muted/50">{children}</th>,
                    td: ({ children }) => <td className="px-3 py-2 border border-border/30">{children}</td>,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
/** Convert a file path like "foo/bar.md" to a URL slug "foo/bar" */
function pathToSlug(filePath: string) {
    return filePath.replace(/\.mdx?$/, '');
}

/** Find a file in the tree whose slug matches the given URL slug */
function findBySlug(nodes: TreeNode[], slug: string): string | null {
    for (const n of nodes) {
        if (n.type === 'file' && pathToSlug(n.path) === slug) return n.path;
        if (n.children) {
            const found = findBySlug(n.children, slug);
            if (found) return found;
        }
    }
    return null;
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function DocsPage() {
    const initialTree = useLoaderData() as TreeNode[];
    const { trackPageView } = useAppTracking('docs');
    useEffect(() => { trackPageView(); }, [trackPageView]);
    const { '*': slugPath } = useParams();
    const navigate = useNavigate();
    const selectedPath = slugPath || null;
    const [tree, setTree] = useState<TreeNode[]>(initialTree);
    const [content, setContent] = useState('');
    const [editContent, setEditContent] = useState('');
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [newDialog, setNewDialog] = useState<'file' | 'folder' | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const loadTree = async () => {
        const res = await fetch('/app/api/docs/tree');
        const data = await res.json();
        setTree(data);
    };

    const loadFile = useCallback(async (filePath: string) => {
        const res = await fetch(`/app/api/docs/file?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) { setContent(''); return; }
        const data = await res.json();
        setContent(data.content);
        setToc(extractToc(data.content));
        setEditing(false);
    }, []);

    useEffect(() => {
        if (selectedPath && tree.length) {
            const filePath = findBySlug(tree, selectedPath);
            if (filePath) loadFile(filePath);
        }
    }, [selectedPath, tree, loadFile]);

    // Auto-select first file when no slug in URL
    useEffect(() => {
        if (tree.length > 0 && !slugPath && !selectedPath) {
            const findFirst = (nodes: TreeNode[]): string | null => {
                for (const n of nodes) {
                    if (n.type === 'file') return n.path;
                    if (n.children) { const f = findFirst(n.children); if (f) return f; }
                }
                return null;
            };
            const first = findFirst(tree);
            if (first) navigate('/docs/' + pathToSlug(first), { replace: true });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tree, selectedPath, navigate]);

    /** Navigate to a file — updates the URL which triggers selectedPath sync */
    const handleSelect = useCallback((path: string) => {
        navigate('/docs/' + pathToSlug(path));
    }, [navigate]);

    const handleSave = async () => {
        if (!selectedPath) return;
        const filePath = findBySlug(tree, selectedPath);
        if (!filePath) return;
        setSaving(true);
        await fetch(`/app/api/docs/file?path=${encodeURIComponent(filePath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: editContent }),
        });
        setContent(editContent);
        setToc(extractToc(editContent));
        setEditing(false);
        setSaving(false);
    };

    const handleCreate = async (name: string, type: 'file' | 'folder') => {
        const basePath = selectedPath
            ? selectedPath.includes('/') ? selectedPath.split('/').slice(0, -1).join('/') : ''
            : '';
        const finalName = type === 'file' && !name.match(/\.mdx?$/) ? name + '.md' : name;
        const newPath = basePath ? `${basePath}/${finalName}` : finalName;
        await fetch('/app/api/docs/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath, type }),
        });
        await loadTree();
        if (type === 'file') navigate('/docs/' + pathToSlug(newPath));
        setNewDialog(null);
    };

    const breadcrumbs = selectedPath ? selectedPath.split('/').map(p => p.replace(/\.mdx?$/, '')) : [];

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left sidebar */}
            <aside className="w-56 shrink-0 border-r border-border/50 bg-sidebar flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-3 border-b border-border/50 shrink-0">
                    <button
                        onClick={() => navigate('/docs')}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                        <Home className="h-3.5 w-3.5" />
                        <span className="font-medium">Docs</span>
                    </button>
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => setNewDialog('file')}
                            className="p-1 rounded hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="New file"
                        >
                            <FilePlus className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => setNewDialog('folder')}
                            className="p-1 rounded hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="New folder"
                        >
                            <FolderPlus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto py-1 px-1">
                    {tree.map(node => (
                        <TreeItem key={node.path} node={node} selected={selectedPath} onSelect={handleSelect} />
                    ))}
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Top bar */}
                    {selectedPath && (
                        <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 shrink-0">
                            {/* Breadcrumbs */}
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                {breadcrumbs.map((crumb, i) => (
                                    <span key={i} className="flex items-center gap-1">
                                        {i > 0 && <ChevronRight className="h-3 w-3" />}
                                        <span className={i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}>
                                            {crumb}
                                        </span>
                                    </span>
                                ))}
                            </div>
                            {/* Actions */}
                            <div className="flex items-center gap-1.5">
                                {editing ? (
                                    <>
                                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEditing(false)}>
                                            <X className="h-3.5 w-3.5" />Discard
                                        </Button>
                                        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
                                            <Save className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save'}
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setEditContent(content); setEditing(true); }}>
                                            <Edit3 className="h-3.5 w-3.5" />Edit
                                        </Button>
                                        <button
                                            onClick={() => { const fp = findBySlug(tree, selectedPath!); if (fp) setDeleteTarget(fp); }}
                                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                            title="Delete file"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Content area */}
                    <div className="flex-1 overflow-y-auto" ref={contentRef}>
                        {!selectedPath ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
                                <p className="text-muted-foreground text-sm">Select a page from the sidebar</p>
                                <p className="text-muted-foreground/50 text-xs">or create a new file with the + button</p>
                            </div>
                        ) : editing ? (
                            <div className="h-full p-6">
                                <Textarea
                                    value={editContent}
                                    onChange={e => setEditContent(e.target.value)}
                                    className="h-full w-full font-mono text-sm resize-none border-0 bg-transparent focus-visible:ring-0 p-0"
                                    placeholder="Write Markdown here…"
                                    autoFocus
                                />
                            </div>
                        ) : (
                            <div className="px-8 py-8 max-w-3xl">
                                <MarkdownContent content={content} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right TOC */}
                {!editing && toc.length > 1 && (
                    <aside className="w-48 shrink-0 border-l border-border/50 overflow-y-auto py-4 px-3 hidden xl:block">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">On this page</p>
                        <div className="space-y-1">
                            {toc.map((item, i) => (
                                <button
                                    key={i}
                                    onClick={() => {
                                        const el = document.getElementById(item.id);
                                        el?.scrollIntoView({ behavior: 'smooth' });
                                    }}
                                    className={cn(
                                        'block text-left w-full text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-0.5',
                                        item.level === 1 ? 'font-medium' : '',
                                        item.level === 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : ''
                                    )}
                                >
                                    {item.text}
                                </button>
                            ))}
                        </div>
                    </aside>
                )}
            </div>

            {/* New file/folder dialog */}
            {newDialog && (
                <NewItemDialog
                    type={newDialog}
                    onClose={() => setNewDialog(null)}
                    onCreate={name => handleCreate(name, newDialog)}
                />
            )}

            {/* Delete confirm */}
            {deleteTarget && (
                <DeleteConfirm
                    path={deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onDeleted={() => { setDeleteTarget(null); navigate('/docs', { replace: true }); setContent(''); loadTree(); }}
                />
            )}
        </div>
    );
}
