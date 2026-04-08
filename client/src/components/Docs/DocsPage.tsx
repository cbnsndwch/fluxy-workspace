import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    Edit3,
    File,
    FilePlus,
    Folder,
    FolderPlus,
    MoreHorizontal,
    Save,
    Settings2,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import remarkGfm from 'remark-gfm';

import { useAppTracking } from '@/components/Analytics/AnalyticsProvider';
import { AppLayout } from '@/components/ui/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────
interface TreeNode {
    name: string;
    /** Custom display label — from frontmatter `title` for files, or meta.json for folders */
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

/** fumadocs-compatible frontmatter schema */
interface DocFrontmatter {
    title?: string;
    description?: string;
    tags?: string[];
    icon?: string;
    full?: boolean;
    [key: string]: unknown;
}

type TreeAction = 'rename' | 'move' | 'delete';

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
            const id = text
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-');
            items.push({ level: match[1].length, text, id });
        }
    }
    return items;
}

function slugify(text: string) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
}

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

/** Find a tree node by file path to get its title */
function findNodeByPath(nodes: TreeNode[], filePath: string): TreeNode | null {
    for (const n of nodes) {
        if (n.path === filePath) return n;
        if (n.children) {
            const found = findNodeByPath(n.children, filePath);
            if (found) return found;
        }
    }
    return null;
}

// ── Tree Node ──────────────────────────────────────────────────────────────────
function TreeItem({
    node,
    selected,
    onSelect,
    onAction,
    depth = 0,
}: {
    node: TreeNode;
    selected: string | null;
    onSelect: (path: string) => void;
    onAction: (action: TreeAction, node: TreeNode) => void;
    depth?: number;
}) {
    const [open, setOpen] = useState(node.defaultOpen ?? depth < 1);
    const [menuOpen, setMenuOpen] = useState(false);

    const actionsEl = (
        <div
            className={cn(
                'absolute right-1 top-1/2 -translate-y-1/2 transition-opacity',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
        >
            <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        onClick={(e) => e.stopPropagation()}
                        className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                        <MoreHorizontal className="h-3 w-3" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem
                        className="text-xs cursor-pointer"
                        onClick={() => onAction('rename', node)}
                    >
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="text-xs cursor-pointer"
                        onClick={() => onAction('move', node)}
                    >
                        Move to…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-xs cursor-pointer text-destructive focus:text-destructive"
                        onClick={() => onAction('delete', node)}
                    >
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );

    if (node.type === 'folder') {
        return (
            <div>
                <div className="group relative">
                    <button
                        onClick={() => setOpen((o) => !o)}
                        className="flex items-center gap-1.5 w-full px-2 py-1 pr-7 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40 rounded transition-colors cursor-pointer"
                        style={{ paddingLeft: `${8 + depth * 12}px` }}
                    >
                        {open ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        <Folder className="h-3 w-3 shrink-0 text-amber-500/70" />
                        <span className="truncate font-medium">
                            {node.title ?? node.name}
                        </span>
                    </button>
                    {actionsEl}
                </div>
                {open &&
                    node.children?.map((child) => (
                        <TreeItem
                            key={child.path}
                            node={child}
                            selected={selected}
                            onSelect={onSelect}
                            onAction={onAction}
                            depth={depth + 1}
                        />
                    ))}
            </div>
        );
    }

    const isActive =
        selected === node.path || selected === node.path.replace(/\.mdx?$/, '');
    // Use frontmatter title if present, else filename without extension
    const label = node.title ?? node.name.replace(/\.mdx?$/, '');
    return (
        <div className="group relative">
            <button
                onClick={() => onSelect(node.path)}
                className={cn(
                    'flex items-center gap-1.5 w-full px-2 py-1 pr-7 text-xs rounded transition-colors cursor-pointer',
                    isActive
                        ? 'bg-sidebar-accent text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40',
                )}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
                <File className="h-3 w-3 shrink-0" />
                <span className="truncate">{label}</span>
            </button>
            {actionsEl}
        </div>
    );
}

// ── New File/Folder Dialog ─────────────────────────────────────────────────────
function NewItemDialog({
    type,
    onClose,
    onCreate,
}: {
    type: 'file' | 'folder';
    onClose: () => void;
    onCreate: (name: string) => void;
}) {
    const [name, setName] = useState('');
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>New {type}</DialogTitle>
                </DialogHeader>
                <Input
                    autoFocus
                    placeholder={
                        type === 'file' ? 'filename.md' : 'folder-name'
                    }
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        name.trim() &&
                        onCreate(name.trim())
                    }
                />
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => onCreate(name.trim())}
                        disabled={!name.trim()}
                    >
                        Create
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────
function DeleteConfirm({
    path,
    onClose,
    onDeleted,
}: {
    path: string;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [deleting, setDeleting] = useState(false);
    const name = path.split('/').pop() ?? path;
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Delete?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {name}
                    </code>{' '}
                    will be permanently deleted.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        disabled={deleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={deleting}
                        onClick={async () => {
                            setDeleting(true);
                            await fetch(
                                `/app/api/docs/file?path=${encodeURIComponent(path)}`,
                                { method: 'DELETE' },
                            );
                            onDeleted();
                        }}
                    >
                        Delete
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Frontmatter Editor Dialog ──────────────────────────────────────────────────
function FrontmatterDialog({
    frontmatter,
    onSave,
    onClose,
}: {
    frontmatter: DocFrontmatter;
    onSave: (fm: DocFrontmatter) => void;
    onClose: () => void;
}) {
    const [title, setTitle] = useState(frontmatter.title ?? '');
    const [description, setDescription] = useState(
        frontmatter.description ?? '',
    );
    const [tagsInput, setTagsInput] = useState(
        (frontmatter.tags ?? []).join(', '),
    );
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        // Spread existing frontmatter to preserve any unknown fields (icon, full, etc.)
        const fm: DocFrontmatter = { ...frontmatter };
        if (title.trim()) fm.title = title.trim();
        else delete fm.title;
        if (description.trim()) fm.description = description.trim();
        else delete fm.description;
        const tags = tagsInput
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        if (tags.length) fm.tags = tags;
        else delete fm.tags;
        onSave(fm);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Page Settings</DialogTitle>
                    <DialogDescription>
                        Edit frontmatter metadata for this page. Changes are
                        saved to the file header.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-1">
                    <div className="space-y-1.5">
                        <Label htmlFor="fm-title">Title</Label>
                        <Input
                            id="fm-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Custom display title (overrides filename in sidebar)"
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="fm-description">Description</Label>
                        <Textarea
                            id="fm-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief page description or subtitle"
                            className="resize-none"
                            rows={2}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="fm-tags">Tags</Label>
                        <Input
                            id="fm-tags"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="comma, separated, tags"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Separate multiple tags with commas
                        </p>
                    </div>
                </div>
                <div className="flex justify-between items-center pt-1">
                    <p className="text-[11px] text-muted-foreground">
                        Frontmatter is also editable in source mode
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Rename Dialog ──────────────────────────────────────────────────────────────────────────────────────
function RenameDialog({
    node,
    onClose,
    onRenamed,
}: {
    node: TreeNode;
    onClose: () => void;
    onRenamed: (newPath: string) => void;
}) {
    const isFile = node.type === 'file';
    const baseName = isFile ? node.name.replace(/\.mdx?$/, '') : node.name;
    const [name, setName] = useState(baseName);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleRename = async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        setSaving(true);
        setError('');
        const dir = node.path.includes('/')
            ? node.path.split('/').slice(0, -1).join('/')
            : '';
        const newName = isFile
            ? trimmed.match(/\.mdx?$/)
                ? trimmed
                : `${trimmed}.md`
            : trimmed;
        const newPath = dir ? `${dir}/${newName}` : newName;
        if (newPath === node.path) {
            onClose();
            return;
        }
        const res = await fetch('/app/api/docs/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: node.path, to: newPath }),
        });
        setSaving(false);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error || 'Rename failed');
        } else {
            onRenamed(newPath);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rename {node.type}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    <Input
                        autoFocus
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setError('');
                        }}
                        onKeyDown={(e) =>
                            e.key === 'Enter' && name.trim() && handleRename()
                        }
                    />
                    {isFile && (
                        <p className="text-xs text-muted-foreground">
                            .md extension will be preserved automatically
                        </p>
                    )}
                    {error && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRename}
                        disabled={!name.trim() || saving}
                    >
                        {saving ? 'Renaming…' : 'Rename'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Move Dialog ────────────────────────────────────────────────────────────────────────────────────────
function collectFolders(nodes: TreeNode[]): { path: string; label: string }[] {
    const result: { path: string; label: string }[] = [
        { path: '', label: '/ root' },
    ];
    const traverse = (items: TreeNode[], prefix: string) => {
        for (const n of items) {
            if (n.type === 'folder') {
                result.push({ path: n.path, label: prefix + n.name });
                if (n.children) traverse(n.children, prefix + n.name + ' / ');
            }
        }
    };
    traverse(nodes, '');
    return result;
}

function MoveDialog({
    node,
    tree,
    onClose,
    onMoved,
}: {
    node: TreeNode;
    tree: TreeNode[];
    onClose: () => void;
    onMoved: (newPath: string) => void;
}) {
    const currentParent = node.path.includes('/')
        ? node.path.split('/').slice(0, -1).join('/')
        : '';
    const [destFolder, setDestFolder] = useState(currentParent);
    const [moving, setMoving] = useState(false);
    const [error, setError] = useState('');

    const allFolders = collectFolders(tree);
    // If moving a folder, exclude itself and all descendants
    const validFolders =
        node.type === 'folder'
            ? allFolders.filter(
                  (f) =>
                      f.path !== node.path &&
                      !f.path.startsWith(node.path + '/'),
              )
            : allFolders;

    const isCurrentLocation = destFolder === currentParent;

    const handleMove = async () => {
        setMoving(true);
        setError('');
        const newPath = destFolder ? `${destFolder}/${node.name}` : node.name;
        const res = await fetch('/app/api/docs/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: node.path, to: newPath }),
        });
        setMoving(false);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error || 'Move failed');
        } else {
            onMoved(newPath);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        Move "{node.name.replace(/\.mdx?$/, '')}"
                    </DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                    Select destination folder:
                </p>
                <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto border border-border/50 rounded-md p-1">
                    {validFolders.map((f) => (
                        <button
                            key={f.path}
                            onClick={() => setDestFolder(f.path)}
                            className={cn(
                                'flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left w-full transition-colors cursor-pointer',
                                destFolder === f.path
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <Folder
                                className={cn(
                                    'h-3.5 w-3.5 shrink-0',
                                    destFolder === f.path
                                        ? 'text-primary-foreground'
                                        : 'text-amber-500/70',
                                )}
                            />
                            <span className="truncate">{f.label}</span>
                            {f.path === currentParent && (
                                <span
                                    className={cn(
                                        'ml-auto text-[10px] shrink-0',
                                        destFolder === f.path
                                            ? 'text-primary-foreground/70'
                                            : 'text-muted-foreground/50',
                                    )}
                                >
                                    current
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={onClose} disabled={moving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleMove}
                        disabled={moving || isCurrentLocation}
                    >
                        {moving ? 'Moving…' : 'Move here'}
                    </Button>
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
                        <h1
                            id={slugify(String(children))}
                            className="text-2xl font-semibold text-foreground tracking-tight mb-6 pb-3 border-b border-border/50 mt-0"
                        >
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2
                            id={slugify(String(children))}
                            className="text-lg font-semibold text-foreground tracking-tight mt-8 mb-3"
                        >
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3
                            id={slugify(String(children))}
                            className="text-base font-semibold text-foreground mt-6 mb-2"
                        >
                            {children}
                        </h3>
                    ),
                    p: ({ children }) => (
                        <p className="leading-7 text-muted-foreground my-3">
                            {children}
                        </p>
                    ),
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            target={
                                href?.startsWith('http') ? '_blank' : undefined
                            }
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            {children}
                        </a>
                    ),
                    strong: ({ children }) => (
                        <strong className="font-semibold text-foreground">
                            {children}
                        </strong>
                    ),
                    em: ({ children }) => (
                        <em className="italic">{children}</em>
                    ),
                    ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-5 space-y-1 my-3">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-5 space-y-1 my-3">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => (
                        <li className="leading-6">{children}</li>
                    ),
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
                        return isBlock ? (
                            <code
                                className={cn('text-xs font-mono', className)}
                                {...props}
                            >
                                {children}
                            </code>
                        ) : (
                            <code
                                className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-foreground"
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="w-full border-collapse text-sm">
                                {children}
                            </table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="border-b border-border/50">
                            {children}
                        </thead>
                    ),
                    th: ({ children }) => (
                        <th className="px-3 py-2 text-left font-medium text-foreground border border-border/30 bg-muted/50">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-3 py-2 border border-border/30">
                            {children}
                        </td>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function DocsPage() {
    const initialTree = useLoaderData() as TreeNode[];
    const { trackPageView } = useAppTracking('docs');
    useEffect(() => {
        trackPageView();
    }, [trackPageView]);
    const { '*': slugPath } = useParams();
    const navigate = useNavigate();
    const selectedPath = slugPath || null;
    const [tree, setTree] = useState<TreeNode[]>(initialTree);
    /** Full raw file content (including FM) — used in source edit mode */
    const [content, setContent] = useState('');
    /** Markdown body with frontmatter stripped — used for rendering */
    const [body, setBody] = useState('');
    /** Parsed frontmatter for the current file */
    const [frontmatter, setFrontmatter] = useState<DocFrontmatter>({});
    const [editContent, setEditContent] = useState('');
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [newDialog, setNewDialog] = useState<'file' | 'folder' | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [fmDialogOpen, setFmDialogOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null);
    const [moveTarget, setMoveTarget] = useState<TreeNode | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const loadTree = async () => {
        const res = await fetch('/app/api/docs/tree');
        const data = await res.json();
        setTree(data);
    };

    const loadFile = useCallback(async (filePath: string) => {
        const res = await fetch(
            `/app/api/docs/file?path=${encodeURIComponent(filePath)}`,
        );
        if (!res.ok) {
            setContent('');
            setBody('');
            setFrontmatter({});
            return;
        }
        const data = await res.json();
        setContent(data.content);
        // Use body (FM-stripped) for rendering; fall back to full content if missing
        const renderBody = data.body ?? data.content;
        setBody(renderBody);
        setFrontmatter(data.frontmatter ?? {});
        setToc(extractToc(renderBody));
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
                    if (n.children) {
                        const f = findFirst(n.children);
                        if (f) return f;
                    }
                }
                return null;
            };
            const first = findFirst(tree);
            if (first)
                navigate('/docs/' + pathToSlug(first), { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tree, selectedPath, navigate]);

    /** Navigate to a file — updates the URL which triggers selectedPath sync */
    const handleSelect = useCallback(
        (path: string) => {
            navigate('/docs/' + pathToSlug(path));
        },
        [navigate],
    );

    /** Save the source edit (full content, including any FM edits) */
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
        // Reload to re-parse FM from the saved content
        await loadFile(filePath);
        await loadTree();
        setSaving(false);
    };

    /** Save only the frontmatter, preserving the markdown body */
    const handleSaveFrontmatter = async (newFm: DocFrontmatter) => {
        if (!selectedPath) return;
        const filePath = findBySlug(tree, selectedPath);
        if (!filePath) return;
        await fetch(`/app/api/docs/file?path=${encodeURIComponent(filePath)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newFm),
        });
        setFrontmatter(newFm);
        // Reload file to sync content state with what's on disk
        await loadFile(filePath);
        // Refresh tree so sidebar title reflects the change
        await loadTree();
        setFmDialogOpen(false);
    };

    const handleCreate = async (name: string, type: 'file' | 'folder') => {
        const basePath = selectedPath
            ? selectedPath.includes('/')
                ? selectedPath.split('/').slice(0, -1).join('/')
                : ''
            : '';
        const finalName =
            type === 'file' && !name.match(/\.mdx?$/) ? name + '.md' : name;
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

    const handleTreeAction = (action: TreeAction, node: TreeNode) => {
        if (action === 'rename') setRenameTarget(node);
        else if (action === 'move') setMoveTarget(node);
        else if (action === 'delete') setDeleteTarget(node.path);
    };

    /**
     * After a rename or move, reload the tree and update navigation if
     * the current file (or a folder containing it) was the affected node.
     */
    const handleRenamedOrMoved = (
        oldPath: string,
        oldType: 'file' | 'folder',
        newPath: string,
    ) => {
        const currentFp = selectedPath ? findBySlug(tree, selectedPath) : null;
        loadTree();
        if (!currentFp) return;
        if (currentFp === oldPath) {
            // The current file was directly renamed/moved
            navigate('/docs/' + pathToSlug(newPath), { replace: true });
        } else if (
            oldType === 'folder' &&
            currentFp.startsWith(oldPath + '/')
        ) {
            // The current file lives inside the renamed/moved folder
            const relative = currentFp.slice(oldPath.length);
            navigate('/docs/' + pathToSlug(newPath + relative), {
                replace: true,
            });
        }
    };

    // Build breadcrumbs — last segment uses FM title if available
    const breadcrumbs = selectedPath
        ? selectedPath.split('/').map((part, idx, arr) => {
              const label = part.replace(/\.mdx?$/, '');
              if (idx === arr.length - 1 && frontmatter.title)
                  return frontmatter.title;
              return label;
          })
        : [];

    const hasFmMeta = Boolean(
        frontmatter.description || (frontmatter.tags ?? []).length > 0,
    );

    return (
        <AppLayout
            icon={<BookOpen size={20} />}
            iconClassName="bg-sky-500/10 text-sky-500"
            title="Docs"
            actions={
                <div className="flex items-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="New file"
                        onClick={() => setNewDialog('file')}
                    >
                        <FilePlus className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="New folder"
                        onClick={() => setNewDialog('folder')}
                    >
                        <FolderPlus className="h-4 w-4" />
                    </Button>
                </div>
            }
        >
            <div className="flex h-full overflow-hidden">
                {/* Left sidebar */}
                <aside className="w-56 shrink-0 border-r border-border/50 bg-sidebar flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto py-2 px-1">
                        {tree.map((node) => (
                            <TreeItem
                                key={node.path}
                                node={node}
                                selected={selectedPath}
                                onSelect={handleSelect}
                                onAction={handleTreeAction}
                            />
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
                                        <span
                                            key={i}
                                            className="flex items-center gap-1"
                                        >
                                            {i > 0 && (
                                                <ChevronRight className="h-3 w-3" />
                                            )}
                                            <span
                                                className={
                                                    i === breadcrumbs.length - 1
                                                        ? 'text-foreground font-medium'
                                                        : ''
                                                }
                                            >
                                                {crumb}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                                {/* Actions */}
                                <div className="flex items-center gap-1.5">
                                    {editing ? (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 gap-1.5 text-xs"
                                                onClick={() =>
                                                    setEditing(false)
                                                }
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                Discard
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-7 gap-1.5 text-xs"
                                                onClick={handleSave}
                                                disabled={saving}
                                            >
                                                <Save className="h-3.5 w-3.5" />
                                                {saving ? 'Saving…' : 'Save'}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() =>
                                                    setFmDialogOpen(true)
                                                }
                                                className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                title="Page settings (frontmatter)"
                                            >
                                                <Settings2 className="h-3.5 w-3.5" />
                                            </button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 gap-1.5 text-xs"
                                                onClick={() => {
                                                    setEditContent(content);
                                                    setEditing(true);
                                                }}
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                                Edit
                                            </Button>
                                            <button
                                                onClick={() => {
                                                    const fp = findBySlug(
                                                        tree,
                                                        selectedPath!,
                                                    );
                                                    if (fp) setDeleteTarget(fp);
                                                }}
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

                        {/* FM meta bar — shows description and tags when present (view mode only) */}
                        {selectedPath && !editing && hasFmMeta && (
                            <div className="flex items-start gap-4 px-8 py-2.5 border-b border-border/50 bg-muted/20 shrink-0">
                                {frontmatter.description && (
                                    <p className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-0">
                                        {frontmatter.description}
                                    </p>
                                )}
                                {(frontmatter.tags ?? []).length > 0 && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Tag className="h-3 w-3 text-muted-foreground/60" />
                                        <div className="flex flex-wrap gap-1">
                                            {(frontmatter.tags ?? []).map(
                                                (tag) => (
                                                    <Badge
                                                        key={tag}
                                                        variant="secondary"
                                                        className="text-[10px] px-1.5 py-0 h-4"
                                                    >
                                                        {tag}
                                                    </Badge>
                                                ),
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Content area */}
                        <div
                            className="flex-1 overflow-y-auto"
                            ref={contentRef}
                        >
                            {!selectedPath ? (
                                <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
                                    <p className="text-muted-foreground text-sm">
                                        Select a page from the sidebar
                                    </p>
                                    <p className="text-muted-foreground/50 text-xs">
                                        or create a new file with the + button
                                    </p>
                                </div>
                            ) : editing ? (
                                /* Source edit mode: full raw content including frontmatter is visible + editable */
                                <div className="h-full p-6">
                                    <Textarea
                                        value={editContent}
                                        onChange={(e) =>
                                            setEditContent(e.target.value)
                                        }
                                        className="h-full w-full font-mono text-sm resize-none border-0 bg-transparent focus-visible:ring-0 p-0"
                                        placeholder="Write Markdown here…"
                                        autoFocus
                                    />
                                </div>
                            ) : (
                                /* Render mode: FM-stripped body only */
                                <div className="px-8 py-8 max-w-3xl">
                                    <MarkdownContent content={body} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right TOC */}
                    {!editing && toc.length > 1 && (
                        <aside className="w-48 shrink-0 border-l border-border/50 overflow-y-auto py-4 px-3 hidden xl:block">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                                On this page
                            </p>
                            <div className="space-y-1">
                                {toc.map((item, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            const el = document.getElementById(
                                                item.id,
                                            );
                                            el?.scrollIntoView({
                                                behavior: 'smooth',
                                            });
                                        }}
                                        className={cn(
                                            'block text-left w-full text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-0.5',
                                            item.level === 1
                                                ? 'font-medium'
                                                : '',
                                            item.level === 3
                                                ? 'pl-4'
                                                : item.level === 2
                                                  ? 'pl-2'
                                                  : '',
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
                        onCreate={(name) => handleCreate(name, newDialog)}
                    />
                )}

                {/* Delete confirm */}
                {deleteTarget && (
                    <DeleteConfirm
                        path={deleteTarget}
                        onClose={() => setDeleteTarget(null)}
                        onDeleted={() => {
                            setDeleteTarget(null);
                            navigate('/docs', { replace: true });
                            setContent('');
                            setBody('');
                            setFrontmatter({});
                            loadTree();
                        }}
                    />
                )}

                {/* Frontmatter editor dialog */}
                {fmDialogOpen && (
                    <FrontmatterDialog
                        frontmatter={frontmatter}
                        onSave={handleSaveFrontmatter}
                        onClose={() => setFmDialogOpen(false)}
                    />
                )}

                {/* Rename dialog */}
                {renameTarget && (
                    <RenameDialog
                        node={renameTarget}
                        onClose={() => setRenameTarget(null)}
                        onRenamed={(newPath) => {
                            const old = renameTarget;
                            setRenameTarget(null);
                            handleRenamedOrMoved(old.path, old.type, newPath);
                        }}
                    />
                )}

                {/* Move dialog */}
                {moveTarget && (
                    <MoveDialog
                        node={moveTarget}
                        tree={tree}
                        onClose={() => setMoveTarget(null)}
                        onMoved={(newPath) => {
                            const old = moveTarget;
                            setMoveTarget(null);
                            handleRenamedOrMoved(old.path, old.type, newPath);
                        }}
                    />
                )}
            </div>
        </AppLayout>
    );
}
