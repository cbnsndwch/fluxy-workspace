import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getSessionUser } from '../../auth/index.js';

// Static registry of permissions contributed by each app.
// Each app declares what actions it supports so roles can grant/deny them.
export const APP_PERMISSIONS: Record<string, { action: string; label: string }[]> = {
    chat: [
        { action: 'access', label: 'Access Fluxy chat' },
    ],
    'app-ideas': [
        { action: 'view', label: 'View app ideas canvas' },
        { action: 'edit', label: 'Create and edit ideas' },
        { action: 'delete', label: 'Delete ideas' },
    ],
    'image-studio': [
        { action: 'view', label: 'View generated images' },
        { action: 'generate', label: 'Generate new images' },
    ],
    workflows: [
        { action: 'view', label: 'View workflows' },
        { action: 'edit', label: 'Create and edit workflows' },
        { action: 'run', label: 'Run workflows' },
        { action: 'delete', label: 'Delete workflows' },
    ],
    'db-viewer': [
        { action: 'view', label: 'Browse database tables' },
    ],
    docs: [
        { action: 'view', label: 'Read documentation' },
        { action: 'edit', label: 'Create and edit docs' },
        { action: 'delete', label: 'Delete docs' },
    ],
    'workspace-issues': [
        { action: 'view', label: 'View workspace issues' },
        { action: 'edit', label: 'Create and edit issues' },
        { action: 'close', label: 'Close and resolve issues' },
    ],
    'user-management': [
        { action: 'view', label: 'View users and roles' },
        { action: 'manage', label: 'Assign roles to users' },
        { action: 'roles-edit', label: 'Create and edit custom roles' },
    ],
};

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    // ── Permission registry ───────────────────────────────────────────────────
    router.get('/api/users/permissions', (_req, res) => {
        res.json(APP_PERMISSIONS);
    });

    // ── Users ─────────────────────────────────────────────────────────────────
    router.get('/api/users', (_req, res) => {
        const users = db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as any[];
        const userRoles = db.prepare(`
            SELECT ur.user_id, r.id, r.name, r.description, r.is_system
            FROM user_roles ur JOIN roles r ON ur.role_id = r.id
        `).all() as any[];
        const roleMap: Record<number, any[]> = {};
        for (const ur of userRoles) {
            if (!roleMap[ur.user_id]) roleMap[ur.user_id] = [];
            roleMap[ur.user_id].push({ id: ur.id, name: ur.name, description: ur.description, is_system: ur.is_system });
        }
        res.json(users.map(u => ({ ...u, roles: roleMap[u.id] || [] })));
    });

    router.get('/api/users/:id', (req, res) => {
        const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as any;
        if (!user) return res.status(404).json({ error: 'User not found' });
        const roles = db.prepare(`
            SELECT r.* FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?
        `).all(req.params.id);
        res.json({ ...user, roles });
    });

    // Assign/replace roles for a user
    router.put('/api/users/:id/roles', (req, res) => {
        const { role_ids } = req.body as { role_ids: number[] };
        if (!Array.isArray(role_ids)) return res.status(400).json({ error: 'role_ids must be an array' });

        // Self-demotion guard: prevent users from modifying their own roles
        const sessionUser = getSessionUser(db, req);
        if (sessionUser && String(sessionUser.id) === String(req.params.id)) {
            return res.status(403).json({ error: 'You cannot modify your own roles' });
        }

        const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(req.params.id);
        const insert = db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`);
        for (const rid of role_ids) insert.run(req.params.id, rid);

        const roles = db.prepare(`
            SELECT r.* FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?
        `).all(req.params.id);
        res.json({ ok: true, roles });
    });

    // ── Roles ─────────────────────────────────────────────────────────────────
    router.get('/api/roles', (_req, res) => {
        const roles = db.prepare(`SELECT * FROM roles ORDER BY is_system DESC, name`).all() as any[];
        const perms = db.prepare(`SELECT * FROM role_permissions`).all() as any[];
        const permMap: Record<number, any[]> = {};
        for (const p of perms) {
            if (!permMap[p.role_id]) permMap[p.role_id] = [];
            permMap[p.role_id].push({ app: p.app, action: p.action });
        }
        res.json(roles.map(r => ({ ...r, permissions: permMap[r.id] || [] })));
    });

    router.post('/api/roles', (req, res) => {
        const { name, description, permissions } = req.body as {
            name: string;
            description?: string;
            permissions?: { app: string; action: string }[];
        };
        if (!name?.trim()) return res.status(400).json({ error: 'name required' });
        try {
            const r = db.prepare(`INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)`)
                .run(name.trim(), description || null);
            const roleId = r.lastInsertRowid;
            if (permissions?.length) {
                const ins = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, app, action) VALUES (?, ?, ?)`);
                for (const p of permissions) ins.run(roleId, p.app, p.action);
            }
            const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(roleId) as any;
            const perms = db.prepare(`SELECT app, action FROM role_permissions WHERE role_id = ?`).all(roleId);
            res.status(201).json({ ...role, permissions: perms });
        } catch (e: any) {
            if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Role name already exists' });
            throw e;
        }
    });

    router.put('/api/roles/:id', (req, res) => {
        const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(req.params.id) as any;
        if (!role) return res.status(404).json({ error: 'Role not found' });
        if (role.is_system) return res.status(403).json({ error: 'Cannot modify system roles' });

        const { name, description, permissions } = req.body as {
            name: string;
            description?: string;
            permissions?: { app: string; action: string }[];
        };
        if (!name?.trim()) return res.status(400).json({ error: 'name required' });

        db.prepare(`UPDATE roles SET name = ?, description = ? WHERE id = ?`)
            .run(name.trim(), description || null, req.params.id);
        db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(req.params.id);
        if (permissions?.length) {
            const ins = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, app, action) VALUES (?, ?, ?)`);
            for (const p of permissions) ins.run(req.params.id, p.app, p.action);
        }

        const updated = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(req.params.id) as any;
        const perms = db.prepare(`SELECT app, action FROM role_permissions WHERE role_id = ?`).all(req.params.id);
        res.json({ ...updated, permissions: perms });
    });

    router.delete('/api/roles/:id', (req, res) => {
        const role = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(req.params.id) as any;
        if (!role) return res.status(404).json({ error: 'Role not found' });
        if (role.is_system) return res.status(403).json({ error: 'Cannot delete system roles' });
        db.prepare(`DELETE FROM roles WHERE id = ?`).run(req.params.id);
        res.json({ ok: true });
    });

    return router;
}
