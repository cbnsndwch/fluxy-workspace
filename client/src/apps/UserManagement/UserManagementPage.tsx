// oxlint-disable no-console
import {
    Check,
    ChevronDown,
    ChevronRight,
    Crown,
    Lock,
    Plus,
    Shield,
    ShieldCheck,
    Trash2,
    Users
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLoaderData } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

// ── Types ──────────────────────────────────────────────────────────────────

interface User {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
    created_at: string;
    roles: Role[];
}

interface Role {
    id: number;
    name: string;
    description: string | null;
    is_system: number;
    permissions: Permission[];
}

interface Permission {
    app: string;
    action: string;
}

type AppPermissions = Record<string, { action: string; label: string }[]>;

// ── App label map ──────────────────────────────────────────────────────────

const APP_LABELS: Record<string, string> = {
    chat: 'Fluxy Chat',
    'app-ideas': 'App Ideas',
    'image-studio': 'Image Studio',
    workflows: 'Workflows',
    'db-viewer': 'DB Viewer',
    docs: 'Docs',
    'workspace-issues': 'Workspace Issues',
    'user-management': 'User Management'
};

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-red-500/10 text-red-500 border-red-500/20',
    operator: 'bg-blue-500/10 text-blue-500 border-blue-500/20'
};

function roleBadgeClass(name: string) {
    return ROLE_COLORS[name] || 'bg-muted text-muted-foreground border-border';
}

// ── Users tab ──────────────────────────────────────────────────────────────

function UsersTab({
    users,
    roles,
    currentUserId,
    onSaveRoles
}: {
    users: User[];
    roles: Role[];
    currentUserId: number | null;
    onSaveRoles: (userId: number, roleIds: number[]) => Promise<void>;
}) {
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [selectedRoles, setSelectedRoles] = useState<number[]>([]);
    const [saving, setSaving] = useState(false);

    function openEdit(u: User) {
        setEditingUser(u);
        setSelectedRoles(u.roles.map(r => r.id));
    }

    async function handleSave() {
        if (!editingUser) return;
        setSaving(true);
        await onSaveRoles(editingUser.id, selectedRoles);
        setSaving(false);
        setEditingUser(null);
    }

    return (
        <div className="space-y-3">
            {users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                    <Users className="h-10 w-10 opacity-30" />
                    <p className="text-sm">No users have logged in yet</p>
                </div>
            ) : (
                users.map(u => (
                    <div
                        key={u.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/20 transition-colors"
                    >
                        {u.avatar_url ? (
                            <img
                                src={u.avatar_url}
                                alt={u.login}
                                className="h-9 w-9 rounded-full object-cover shrink-0"
                            />
                        ) : (
                            <div className="h-9 w-9 rounded-full bg-muted shrink-0 flex items-center justify-center">
                                <span className="text-xs font-medium text-muted-foreground">
                                    {u.login[0].toUpperCase()}
                                </span>
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">
                                    {u.name || u.login}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    @{u.login}
                                </span>
                                {u.id === currentUserId && (
                                    <Badge
                                        variant="outline"
                                        className="text-xs border-teal-500/30 text-teal-500 bg-teal-500/5"
                                    >
                                        You
                                    </Badge>
                                )}
                            </div>
                            {u.email && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {u.email}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {u.roles.length === 0 ? (
                                <Badge
                                    variant="outline"
                                    className="text-xs text-muted-foreground"
                                >
                                    No roles
                                </Badge>
                            ) : (
                                u.roles.map(r => (
                                    <Badge
                                        key={r.id}
                                        variant="outline"
                                        className={cn(
                                            'text-xs border',
                                            roleBadgeClass(r.name)
                                        )}
                                    >
                                        {r.is_system ? (
                                            <Crown className="h-2.5 w-2.5 mr-1" />
                                        ) : null}
                                        {r.name}
                                    </Badge>
                                ))
                            )}
                        </div>
                        {u.id === currentUserId ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="shrink-0">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled
                                                className="text-xs text-muted-foreground/40 shrink-0 gap-1.5"
                                            >
                                                <Lock className="h-3 w-3" />
                                                Edit
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                        <p>You can't modify your own roles</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                                onClick={() => openEdit(u)}
                            >
                                Edit
                            </Button>
                        )}
                    </div>
                ))
            )}

            {/* Edit user roles dialog */}
            <Dialog
                open={!!editingUser}
                onOpenChange={open => {
                    if (!open) setEditingUser(null);
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Edit Roles — @{editingUser?.login}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 max-h-72 overflow-y-auto py-1">
                        {roles.map(r => {
                            const active = selectedRoles.includes(r.id);
                            return (
                                <button
                                    key={r.id}
                                    type="button"
                                    onClick={() =>
                                        setSelectedRoles(
                                            active
                                                ? selectedRoles.filter(
                                                      x => x !== r.id
                                                  )
                                                : [...selectedRoles, r.id]
                                        )
                                    }
                                    className={cn(
                                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer',
                                        active
                                            ? 'border-primary/40 bg-primary/5'
                                            : 'border-border/50 hover:bg-accent/30'
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                                            active
                                                ? 'bg-primary border-primary'
                                                : 'border-muted-foreground/30'
                                        )}
                                    >
                                        {active && (
                                            <Check className="h-2.5 w-2.5 text-primary-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            {r.is_system ? (
                                                <Crown className="h-3 w-3 text-amber-500" />
                                            ) : (
                                                <Shield className="h-3 w-3 text-muted-foreground" />
                                            )}
                                            <span className="text-sm font-medium">
                                                {r.name}
                                            </span>
                                        </div>
                                        {r.description && (
                                            <p className="text-xs text-muted-foreground truncate">
                                                {r.description}
                                            </p>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setEditingUser(null)}
                            className="cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            className="cursor-pointer"
                        >
                            {saving ? 'Saving…' : 'Save roles'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Roles tab ──────────────────────────────────────────────────────────────

function PermissionToggle({
    label,
    checked,
    onChange
}: {
    app: string;
    action: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs border transition-colors cursor-pointer',
                checked
                    ? 'bg-primary/10 border-primary/30 text-foreground'
                    : 'bg-transparent border-border/40 text-muted-foreground hover:border-border hover:text-foreground'
            )}
        >
            <div
                className={cn(
                    'h-3 w-3 rounded-sm border flex items-center justify-center shrink-0',
                    checked
                        ? 'bg-primary border-primary'
                        : 'border-muted-foreground/40'
                )}
            >
                {checked && (
                    <Check className="h-2 w-2 text-primary-foreground" />
                )}
            </div>
            {label}
        </button>
    );
}

function RoleEditor({
    appPerms,
    initial,
    onSave,
    onCancel
}: {
    appPerms: AppPermissions;
    initial?: Role;
    onSave: (data: {
        name: string;
        description: string;
        permissions: Permission[];
    }) => Promise<void>;
    onCancel: () => void;
}) {
    const [name, setName] = useState(initial?.name || '');
    const [description, setDescription] = useState(initial?.description || '');
    const [perms, setPerms] = useState<Permission[]>(
        initial?.permissions || []
    );
    const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>(
        {}
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    function hasPermission(app: string, action: string) {
        return perms.some(p => p.app === app && p.action === action);
    }

    function togglePerm(app: string, action: string, on: boolean) {
        setPerms(
            on
                ? [...perms, { app, action }]
                : perms.filter(p => !(p.app === app && p.action === action))
        );
    }

    function toggleApp(app: string, actions: { action: string }[]) {
        const allOn = actions.every(a => hasPermission(app, a.action));
        if (allOn) {
            setPerms(perms.filter(p => p.app !== app));
        } else {
            const existing = perms.filter(p => p.app !== app);
            setPerms([
                ...existing,
                ...actions.map(a => ({ app, action: a.action }))
            ]);
        }
    }

    async function handleSave() {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onSave({
                name: name.trim(),
                description: description.trim(),
                permissions: perms
            });
        } catch (e: any) {
            setError(e.message || 'Save failed');
            setSaving(false);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-3">
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Name
                    </label>
                    <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. editor, viewer, content-manager"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Description
                    </label>
                    <Textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="What can users with this role do?"
                        rows={2}
                        className="resize-none"
                    />
                </div>
            </div>

            <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                    Permissions
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                    {Object.entries(appPerms).map(([app, actions]) => {
                        const allOn = actions.every(a =>
                            hasPermission(app, a.action)
                        );
                        const someOn = actions.some(a =>
                            hasPermission(app, a.action)
                        );
                        const expanded = expandedApps[app] !== false; // default expanded

                        return (
                            <div
                                key={app}
                                className="border border-border/50 rounded-lg overflow-hidden"
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandedApps(prev => ({
                                            ...prev,
                                            [app]: !expanded
                                        }))
                                    }
                                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                                >
                                    {expanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                    <span className="text-sm font-medium flex-1 text-left">
                                        {APP_LABELS[app] || app}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={e => {
                                            e.stopPropagation();
                                            toggleApp(app, actions);
                                        }}
                                        className={cn(
                                            'text-xs px-2 py-0.5 rounded border cursor-pointer',
                                            allOn
                                                ? 'border-primary/40 text-primary bg-primary/5'
                                                : someOn
                                                  ? 'border-amber-500/40 text-amber-500'
                                                  : 'border-border text-muted-foreground'
                                        )}
                                    >
                                        {allOn
                                            ? 'All'
                                            : someOn
                                              ? 'Some'
                                              : 'None'}
                                    </button>
                                </button>
                                {expanded && (
                                    <div className="px-3 py-2 flex flex-wrap gap-1.5">
                                        {actions.map(a => (
                                            <PermissionToggle
                                                key={a.action}
                                                app={app}
                                                action={a.action}
                                                label={a.label}
                                                checked={hasPermission(
                                                    app,
                                                    a.action
                                                )}
                                                onChange={on =>
                                                    togglePerm(
                                                        app,
                                                        a.action,
                                                        on
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
                <Button
                    variant="outline"
                    onClick={onCancel}
                    className="cursor-pointer"
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="cursor-pointer"
                >
                    {saving ? 'Saving…' : 'Save role'}
                </Button>
            </div>
        </div>
    );
}

function RolesTab({
    roles,
    appPerms,
    onCreate,
    onUpdate,
    onDelete
}: {
    roles: Role[];
    appPerms: AppPermissions;
    onCreate: (data: {
        name: string;
        description: string;
        permissions: Permission[];
    }) => Promise<void>;
    onUpdate: (
        id: number,
        data: { name: string; description: string; permissions: Permission[] }
    ) => Promise<void>;
    onDelete: (id: number) => Promise<void>;
}) {
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<Role | null>(null);
    const [expandedRole, setExpandedRole] = useState<number | null>(null);

    async function handleCreate(data: any) {
        await onCreate(data);
        setCreating(false);
    }

    async function handleUpdate(data: any) {
        if (!editing) return;
        await onUpdate(editing.id, data);
        setEditing(null);
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button
                    size="sm"
                    onClick={() => setCreating(true)}
                    className="cursor-pointer gap-1.5"
                >
                    <Plus className="h-3.5 w-3.5" />
                    New role
                </Button>
            </div>

            {/* Create dialog */}
            <Dialog
                open={creating}
                onOpenChange={open => {
                    if (!open) setCreating(false);
                }}
            >
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Create Role</DialogTitle>
                    </DialogHeader>
                    <RoleEditor
                        appPerms={appPerms}
                        onSave={handleCreate}
                        onCancel={() => setCreating(false)}
                    />
                </DialogContent>
            </Dialog>

            {/* Edit dialog */}
            <Dialog
                open={!!editing}
                onOpenChange={open => {
                    if (!open) setEditing(null);
                }}
            >
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Role — {editing?.name}</DialogTitle>
                    </DialogHeader>
                    {editing && (
                        <RoleEditor
                            appPerms={appPerms}
                            initial={editing}
                            onSave={handleUpdate}
                            onCancel={() => setEditing(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {roles.map(r => {
                const isExpanded = expandedRole === r.id;
                const permsByApp = r.permissions.reduce<
                    Record<string, string[]>
                >((acc, p) => {
                    if (!acc[p.app]) acc[p.app] = [];
                    acc[p.app].push(p.action);
                    return acc;
                }, {});

                return (
                    <div
                        key={r.id}
                        className="border border-border/50 rounded-lg overflow-hidden"
                    >
                        <div
                            // oxlint-disable-next-line jsx_a11y/prefer-tag-over-role -- nested Edit/Delete buttons
                            role="button"
                            tabIndex={0}
                            className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/20 transition-colors"
                            onClick={() =>
                                setExpandedRole(isExpanded ? null : r.id)
                            }
                            onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setExpandedRole(isExpanded ? null : r.id);
                                }
                            }}
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex items-center gap-2 shrink-0">
                                {r.is_system ? (
                                    <Crown className="h-4 w-4 text-amber-500" />
                                ) : (
                                    <Shield className="h-4 w-4 text-muted-foreground" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {r.name}
                                    </span>
                                    {r.is_system ? (
                                        <Badge
                                            variant="outline"
                                            className="text-xs text-amber-500 border-amber-500/30"
                                        >
                                            system
                                        </Badge>
                                    ) : null}
                                </div>
                                {r.description && (
                                    <p className="text-xs text-muted-foreground">
                                        {r.description}
                                    </p>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                                {r.permissions.length} perm
                                {r.permissions.length !== 1 ? 's' : ''}
                            </span>
                            {!r.is_system && (
                                <div
                                    role="presentation"
                                    className="flex gap-1 shrink-0"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs cursor-pointer"
                                        onClick={() => setEditing(r)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-destructive cursor-pointer"
                                        onClick={() => onDelete(r.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        {isExpanded && (
                            <div className="border-t border-border/50 px-4 py-3 bg-muted/20">
                                {r.permissions.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic">
                                        No permissions assigned
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {Object.entries(permsByApp).map(
                                            ([app, actions]) => (
                                                <div
                                                    key={app}
                                                    className="flex items-start gap-3"
                                                >
                                                    <span className="text-xs font-medium text-muted-foreground w-32 shrink-0 pt-0.5">
                                                        {APP_LABELS[app] || app}
                                                    </span>
                                                    <div className="flex flex-wrap gap-1">
                                                        {actions.map(a => (
                                                            <Badge
                                                                key={a}
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                {a}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader() {
    const [usersRes, rolesRes, permsRes] = await Promise.all([
        fetch('/app/api/users'),
        fetch('/app/api/roles'),
        fetch('/app/api/users/permissions')
    ]);
    const [users, roles, appPerms] = await Promise.all([
        usersRes.json(),
        rolesRes.json(),
        permsRes.json()
    ]);
    return { users, roles, appPerms };
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function UserManagementPage() {
    const {
        users: initialUsers,
        roles: initialRoles,
        appPerms: initialPerms
    } = useLoaderData() as {
        users: User[];
        roles: Role[];
        appPerms: AppPermissions;
    };
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [roles, setRoles] = useState<Role[]>(initialRoles);
    const [appPerms, setAppPerms] = useState<AppPermissions>(initialPerms);
    const [loading, setLoading] = useState(false);
    const currentUser = useAuthStore(s => s.user);

    const load = useCallback(async () => {
        const [usersRes, rolesRes, permsRes] = await Promise.all([
            fetch('/app/api/users'),
            fetch('/app/api/roles'),
            fetch('/app/api/users/permissions')
        ]);
        const [u, r, p] = await Promise.all([
            usersRes.json(),
            rolesRes.json(),
            permsRes.json()
        ]);
        setUsers(u);
        setRoles(r);
        setAppPerms(p);
        setLoading(false);
    }, []);

    async function handleSaveRoles(userId: number, roleIds: number[]) {
        await fetch(`/app/api/users/${userId}/roles`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role_ids: roleIds })
        });
        await load();
    }

    async function handleCreateRole(data: {
        name: string;
        description: string;
        permissions: Permission[];
    }) {
        const res = await fetch('/app/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to create role');
        }
        await load();
    }

    async function handleUpdateRole(
        id: number,
        data: { name: string; description: string; permissions: Permission[] }
    ) {
        const res = await fetch(`/app/api/roles/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to update role');
        }
        await load();
    }

    async function handleDeleteRole(id: number) {
        await fetch(`/app/api/roles/${id}`, { method: 'DELETE' });
        await load();
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
                <div className="p-2.5 rounded-lg bg-teal-500/10 text-teal-500 shrink-0">
                    <ShieldCheck size={20} />
                </div>
                <div>
                    <h1 className="text-lg font-semibold">User Management</h1>
                    <p className="text-xs text-muted-foreground">
                        Manage users and their roles across the workspace
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    Loading…
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    <Tabs defaultValue="users" className="h-full flex flex-col">
                        <div className="px-6 pt-4 shrink-0">
                            <TabsList>
                                <TabsTrigger
                                    value="users"
                                    className="cursor-pointer gap-1.5"
                                >
                                    <Users className="h-3.5 w-3.5" />
                                    Users
                                    <Badge
                                        variant="secondary"
                                        className="text-xs ml-1"
                                    >
                                        {users.length}
                                    </Badge>
                                </TabsTrigger>
                                <TabsTrigger
                                    value="roles"
                                    className="cursor-pointer gap-1.5"
                                >
                                    <Shield className="h-3.5 w-3.5" />
                                    Roles
                                    <Badge
                                        variant="secondary"
                                        className="text-xs ml-1"
                                    >
                                        {roles.length}
                                    </Badge>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent
                            value="users"
                            className="flex-1 overflow-y-auto px-6 pb-6 mt-4"
                        >
                            <UsersTab
                                users={users}
                                roles={roles}
                                currentUserId={currentUser?.id ?? null}
                                onSaveRoles={handleSaveRoles}
                            />
                        </TabsContent>

                        <TabsContent
                            value="roles"
                            className="flex-1 overflow-y-auto px-6 pb-6 mt-4"
                        >
                            <RolesTab
                                roles={roles}
                                appPerms={appPerms}
                                onCreate={handleCreateRole}
                                onUpdate={handleUpdateRole}
                                onDelete={handleDeleteRole}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
            )}
        </div>
    );
}
