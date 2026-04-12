import { randomBytes } from 'crypto';
import { Router } from 'express';

import type Database from 'better-sqlite3';
import type { Request } from 'express';

export interface DbUser {
    id: number;
    github_id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
}

export function getSessionCookie(req: Request): string | null {
    const raw = req.headers.cookie || '';
    const match = raw.match(/(?:^|;\s*)session=([^;]+)/);
    return match ? match[1] : null;
}

/** Resolve a session token from Authorization header or cookie. */
function getToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return getSessionCookie(req);
}

export function getSessionUser(
    db: InstanceType<typeof Database>,
    req: Request
): DbUser | null {
    const token = getToken(req);
    if (!token) return null;
    return (
        (db
            .prepare(
                'SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?'
            )
            .get(token) as DbUser | undefined) ?? null
    );
}

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
    const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
    const GITHUB_REDIRECT_URI =
        process.env.GITHUB_REDIRECT_URI ||
        'http://localhost:3000/app/api/auth/github/callback';

    router.get('/api/auth/github', (_req, res) => {
        if (!GITHUB_CLIENT_ID)
            return res.status(500).json({
                error: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env'
            });
        const url = new URL('https://github.com/login/oauth/authorize');
        url.searchParams.set('client_id', GITHUB_CLIENT_ID);
        url.searchParams.set('redirect_uri', GITHUB_REDIRECT_URI);
        url.searchParams.set('scope', 'read:user user:email');
        res.redirect(url.toString());
    });

    router.get('/api/auth/github/callback', async (req, res) => {
        const code = req.query.code as string;
        if (!code) return res.redirect('/app/?auth_error=missing_code');
        try {
            const tokenRes = await fetch(
                'https://github.com/login/oauth/access_token',
                {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        client_secret: GITHUB_CLIENT_SECRET,
                        code
                    })
                }
            );
            const tokenData = (await tokenRes.json()) as {
                access_token?: string;
                error?: string;
            };
            if (!tokenData.access_token)
                throw new Error(tokenData.error || 'No access token returned');

            const userRes = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    Accept: 'application/vnd.github+json'
                }
            });
            const ghUser = (await userRes.json()) as {
                id: number;
                login: string;
                name?: string;
                avatar_url?: string;
                email?: string;
            };

            db.prepare(`
                INSERT INTO users (github_id, login, name, avatar_url, email) VALUES (?,?,?,?,?)
                ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url, email=excluded.email
            `).run(
                ghUser.id,
                ghUser.login,
                ghUser.name ?? null,
                ghUser.avatar_url ?? null,
                ghUser.email ?? null
            );

            const user = db
                .prepare('SELECT * FROM users WHERE github_id = ?')
                .get(ghUser.id) as DbUser;
            const token = randomBytes(32).toString('hex');
            db.prepare(
                'INSERT INTO sessions (token, user_id) VALUES (?,?)'
            ).run(token, user.id);

            // Set HttpOnly cookie for direct HTTP requests.
            // Also embed the token in the redirect URL so the frontend can persist it
            // to localStorage and pass it as an Authorization header — required for
            // WebSocket-proxied fetches which cannot forward browser cookies.
            res.setHeader(
                'Set-Cookie',
                `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`
            );
            res.redirect(`/app/?_t=${token}`);
        } catch (err) {
            console.error('[auth] GitHub callback error:', err);
            res.redirect('/app/?auth_error=1');
        }
    });

    router.get('/api/auth/me', (req, res) => {
        const user = getSessionUser(db, req);
        if (!user) return res.status(401).json({ error: 'Not authenticated' });
        res.json(user);
    });

    router.post('/api/auth/logout', (req, res) => {
        const token = getToken(req);
        if (token)
            db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        res.setHeader(
            'Set-Cookie',
            'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
        );
        res.json({ ok: true });
    });

    return router;
}
