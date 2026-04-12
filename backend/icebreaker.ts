import { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { Database as DatabaseType } from 'better-sqlite3';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Headline {
    id: string;
    title: string;
    url: string;
    source: string; // 'hn' | 'techcrunch' | 'verge' | 'ars'
    score?: number;
    publishedAt?: number; // unix seconds
}

export interface TrendingArticle {
    title: string;
    url: string;
    source: string;
    publishedAt?: number;
}

export interface TrendingCluster {
    id: string;
    topic: string; // Representative title
    sourceCount: number; // How many distinct sources cover this
    sources: string[]; // List of distinct source ids
    articles: TrendingArticle[];
}

interface HeadlineCache {
    headlines: Headline[];
    fetchedAt: number;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let cache: HeadlineCache | null = null;
const CACHE_TTL = 30 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

// ── RSS Parser ────────────────────────────────────────────────────────────────

function parseRss(xml: string, source: string): Headline[] {
    const headlines: Headline[] = [];

    // Handle both <item> (RSS 2.0) and <entry> (Atom)
    const itemPattern = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
    let match: RegExpExecArray | null;

    while ((match = itemPattern.exec(xml)) !== null) {
        const block = match[1];

        // Title — handle CDATA (allow attributes on title tag e.g. type="html")
        const titleMatch =
            block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
            block.match(/<title[^>]*>([\s\S]*?)<\/title>/);

        // URL — link, then guid
        const linkMatch =
            block.match(/<link[^>]*href=["'](https?:\/\/[^"']+)["']/) ||
            block.match(/<link>(https?:\/\/[^\s<]+)<\/link>/) ||
            block.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/);

        // Published date
        const dateMatch =
            block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ||
            block.match(/<published>([\s\S]*?)<\/published>/) ||
            block.match(/<updated>([\s\S]*?)<\/updated>/);

        if (!titleMatch || !linkMatch) continue;

        const title = titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#\d+;/g, '')
            .trim();
        const url = linkMatch[1].trim();

        if (!title || title.toLowerCase() === source.toLowerCase()) continue;
        // Skip extremely short or obviously nav titles
        if (
            title.length < 10 ||
            /^(home|news|tech|technology|latest)$/i.test(title)
        )
            continue;

        const publishedAt = dateMatch
            ? Math.floor(new Date(dateMatch[1].trim()).getTime() / 1000)
            : undefined;

        headlines.push({
            id: `${source}-${simpleHash(title + url)}`,
            title,
            url,
            source,
            publishedAt
        });
    }

    return headlines.slice(0, 15);
}

// ── Fetch Sources ─────────────────────────────────────────────────────────────

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; FluxyBot/1.0; +https://fluxy.bot)',
    Accept: 'application/rss+xml, application/atom+xml, text/xml, */*'
};

async function fetchRss(url: string, source: string): Promise<Headline[]> {
    try {
        const r = await fetch(url, {
            headers: HEADERS,
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) return [];
        const xml = await r.text();
        return parseRss(xml, source);
    } catch {
        return [];
    }
}

async function fetchHN(): Promise<Headline[]> {
    try {
        const r = await fetch(
            'https://hacker-news.firebaseio.com/v0/topstories.json',
            {
                signal: AbortSignal.timeout(8000)
            }
        );
        const ids: number[] = await r.json();
        const top40 = ids.slice(0, 40);

        const items = await Promise.all(
            top40.map(async id => {
                try {
                    const ir = await fetch(
                        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
                        {
                            signal: AbortSignal.timeout(5000)
                        }
                    );
                    return await ir.json();
                } catch {
                    return null;
                }
            })
        );

        return items
            .filter(s => s && s.type === 'story' && s.score >= 100 && s.title)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
            .map(s => ({
                id: `hn-${s.id}`,
                title: s.title as string,
                url:
                    (s.url as string | undefined) ??
                    `https://news.ycombinator.com/item?id=${s.id}`,
                source: 'hn',
                score: s.score as number,
                publishedAt: s.time as number
            }));
    } catch {
        return [];
    }
}

async function fetchAllHeadlines(): Promise<Headline[]> {
    const [hn, tc, verge, ars] = await Promise.all([
        fetchHN(),
        fetchRss('https://techcrunch.com/feed/', 'techcrunch'),
        fetchRss('https://www.theverge.com/rss/index.xml', 'verge'),
        fetchRss('https://feeds.arstechnica.com/arstechnica/index', 'ars')
    ]);

    // Merge and deduplicate by similar title
    const all: Headline[] = [];
    const seen = new Set<string>();

    for (const h of [...hn, ...tc, ...verge, ...ars]) {
        const key = h.title.toLowerCase().slice(0, 40);
        if (!seen.has(key)) {
            seen.add(key);
            all.push(h);
        }
    }

    // Sort by recency — items with no publishedAt go to the bottom
    return all.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

// ── Trending Clustering ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'a',
    'an',
    'the',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'and',
    'or',
    'but',
    'is',
    'are',
    'was',
    'were',
    'has',
    'have',
    'had',
    'with',
    'from',
    'by',
    'as',
    'be',
    'it',
    'its',
    'this',
    'that',
    'about',
    'after',
    'before',
    'over',
    'under',
    'what',
    'how',
    'why',
    'when',
    'who',
    'new',
    'says',
    'say',
    'will',
    'can',
    'may',
    'could',
    'would',
    'should',
    'did',
    'do',
    'does',
    'not',
    'no',
    'its',
    'than',
    'then',
    'so',
    'if',
    'up',
    'out',
    'us',
    'just',
    'more',
    'also',
    'into',
    'after',
    'here',
    'now'
]);

function tokenize(title: string): Set<string> {
    const words = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    // Simple suffix normalization: plurals, -ing, -ed, -er
    const stemmed = words.map(w =>
        w.replace(/(?:ing|tion|tions|ed|ers|er|ies)$/, '').replace(/s$/, '')
    );
    return new Set(stemmed);
}

function jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
}

function clusterTrendingTopics(headlines: Headline[]): TrendingCluster[] {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 24 * 60 * 60;

    // Use headlines from last 24h, or all if no timestamp
    const recent = headlines.filter(
        h => !h.publishedAt || h.publishedAt >= cutoff
    );

    const tokens = recent.map(h => tokenize(h.title));

    // Greedy single-link clustering: compare each new article against the first in each cluster
    const clusterIndices: number[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < recent.length; i++) {
        if (assigned.has(i)) continue;
        let placed = false;

        for (const cluster of clusterIndices) {
            // Compare against representative (first) and also any cluster member
            const maxSim = Math.max(
                jaccard(tokens[i], tokens[cluster[0]]),
                jaccard(tokens[i], tokens[cluster[cluster.length - 1]])
            );
            if (maxSim >= 0.18) {
                cluster.push(i);
                assigned.add(i);
                placed = true;
                break;
            }
        }

        if (!placed) {
            clusterIndices.push([i]);
            assigned.add(i);
        }
    }

    const result: TrendingCluster[] = [];

    for (const idxs of clusterIndices) {
        const articles = idxs.map(i => recent[i]);
        const sources = [...new Set(articles.map(a => a.source))];

        // Only surface clusters covered by 2+ distinct sources
        if (sources.length < 2) continue;

        // Representative title: prefer a named publication over HN (which often has submission titles)
        const rep =
            articles.find(a => a.source !== 'hn') ??
            articles.reduce((best, cur) =>
                (cur.title?.length ?? 0) > (best.title?.length ?? 0)
                    ? cur
                    : best
            );

        result.push({
            id: simpleHash(articles.map(a => a.id).join('|')),
            topic: rep.title,
            sourceCount: sources.length,
            sources,
            articles: articles.map(a => ({
                title: a.title,
                url: a.url,
                source: a.source,
                publishedAt: a.publishedAt
            }))
        });
    }

    // Sort: most sources first, then by article count
    return result.sort((a, b) =>
        b.sourceCount !== a.sourceCount
            ? b.sourceCount - a.sourceCount
            : b.articles.length - a.articles.length
    );
}

// ── DB Setup ──────────────────────────────────────────────────────────────────

function initDb(db: DatabaseType) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS icebreaker_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      used_at TEXT NOT NULL,
      session_label TEXT,
      source_headlines TEXT
    );
  `);
}

// ── Local Question Bank ───────────────────────────────────────────────────────

interface BankQuestion {
    q: string;
    wildness: number; // 1–10
    existential: number; // 1–10
    steven?: boolean;
}

const QUESTION_BANK: BankQuestion[] = [
    // Low wildness, low existential (fun / concrete)
    {
        q: "What's one keyboard shortcut you swear by that most people don't know?",
        wildness: 1,
        existential: 1
    },
    {
        q: 'Tabs or spaces — and are you willing to die on that hill?',
        wildness: 2,
        existential: 1
    },
    {
        q: "What's your current terminal setup and are you proud of it?",
        wildness: 1,
        existential: 1
    },
    {
        q: "What's the most creative variable name you've ever used in production?",
        wildness: 2,
        existential: 1
    },
    {
        q: 'If your IDE theme said something about your personality, what would yours say?',
        wildness: 1,
        existential: 2
    },
    {
        q: "What's the last thing you Googled for code that you were embarrassed to not know?",
        wildness: 2,
        existential: 2
    },
    {
        q: "What's one dev tool you can't believe you lived without?",
        wildness: 1,
        existential: 1
    },
    {
        q: "What's the most over-engineered thing you've ever built?",
        wildness: 3,
        existential: 2
    },
    {
        q: 'Best debugging trick you actually use in the wild?',
        wildness: 1,
        existential: 1
    },
    {
        q: "What's a library or framework you quietly love that nobody else cares about?",
        wildness: 2,
        existential: 2
    },

    // Medium wildness, low-medium existential
    {
        q: "What's the most questionable technical decision you defended in a meeting?",
        wildness: 5,
        existential: 3
    },
    {
        q: "What's one thing you ship that you hope nobody reads the code for?",
        wildness: 5,
        existential: 3
    },
    {
        q: "What's the worst naming convention you've inherited from another codebase?",
        wildness: 4,
        existential: 2
    },
    {
        q: 'Have you ever merged something you knew was wrong just to end the PR review?',
        wildness: 6,
        existential: 3
    },
    {
        q: "What's a tech opinion you held strongly a year ago that you've since reversed?",
        wildness: 5,
        existential: 4
    },
    {
        q: "What's the most time you've spent debugging something that turned out to be a typo?",
        wildness: 3,
        existential: 1
    },
    {
        q: 'Which tech hype cycle are you most embarrassed to have believed in?',
        wildness: 5,
        existential: 3
    },
    {
        q: "What's a 'best practice' you openly ignore?",
        wildness: 6,
        existential: 3
    },
    {
        q: "What's the longest you've left a TODO comment in production code?",
        wildness: 4,
        existential: 2
    },
    {
        q: "What's the most diplomatically-worded 'this is a mess' you've written in a code review?",
        wildness: 5,
        existential: 3
    },

    // Medium-high wildness, medium existential
    {
        q: 'Which widely-used technology do you think is secretly terrible?',
        wildness: 7,
        existential: 4
    },
    {
        q: "What's the most irresponsible thing you've shipped under deadline pressure?",
        wildness: 7,
        existential: 5
    },
    {
        q: "Which company's engineering blog do you think is mostly fiction?",
        wildness: 7,
        existential: 3
    },
    {
        q: "What's the most overhyped developer tool of the last two years?",
        wildness: 6,
        existential: 4
    },
    {
        q: "Have you ever used AI-generated code you didn't fully understand in production?",
        wildness: 7,
        existential: 5
    },
    {
        q: "What's something the industry calls a 'best practice' that you think is actively harmful?",
        wildness: 7,
        existential: 5
    },
    {
        q: 'Which startup pitch have you heard that you were sure was nonsense but turned out to succeed?',
        wildness: 6,
        existential: 4
    },
    {
        q: "What's the most expensive AWS bill you've accidentally caused?",
        wildness: 6,
        existential: 3
    },
    {
        q: "When did you last say 'this is fine' about something that wasn't fine?",
        wildness: 6,
        existential: 4
    },

    // High wildness, high existential
    {
        q: 'What technology are you personally building that you think might be a net negative for the world?',
        wildness: 9,
        existential: 9,
        steven: true
    },
    {
        q: 'Is the software industry making humanity better or worse, net net?',
        wildness: 9,
        existential: 9,
        steven: true
    },
    {
        q: 'Which widely-celebrated tech company do you think is actually harmful?',
        wildness: 9,
        existential: 8,
        steven: true
    },
    {
        q: "What's the biggest thing your team does that everyone knows is wrong but nobody will say out loud?",
        wildness: 9,
        existential: 8,
        steven: true
    },
    {
        q: "Are you proud of everything you've shipped in the last year?",
        wildness: 8,
        existential: 8,
        steven: true
    },
    {
        q: "If AI takes most programming jobs, do you think that's a bad thing?",
        wildness: 8,
        existential: 9,
        steven: true
    },
    {
        q: "What's the most morally questionable feature request you've actually built?",
        wildness: 9,
        existential: 8,
        steven: true
    },
    {
        q: 'Do you think open source is actually free, or are we all just doing free labor for corporations?',
        wildness: 8,
        existential: 8,
        steven: true
    },
    {
        q: "What's a company you'd refuse to work for, and why is the line there specifically?",
        wildness: 8,
        existential: 7,
        steven: true
    },
    {
        q: "When's the last time you shipped something that made you feel good about your work — not just done?",
        wildness: 7,
        existential: 8,
        steven: true
    },

    // Medium wildness, high existential
    {
        q: "What's the most important software that humanity has ever written?",
        wildness: 4,
        existential: 9
    },
    {
        q: 'If you could un-invent one piece of technology, what would it be?',
        wildness: 5,
        existential: 9
    },
    {
        q: "Do you think software can be beautiful? What's the most beautiful code you've seen?",
        wildness: 3,
        existential: 8
    },
    {
        q: "What's the biggest unsolved problem in software that nobody talks about?",
        wildness: 5,
        existential: 9
    },
    {
        q: 'If the internet disappeared for a week, what would you do with your time?',
        wildness: 4,
        existential: 7
    },
    {
        q: 'In 50 years, what do you think developers will look back on and cringe about today?',
        wildness: 4,
        existential: 9
    },
    {
        q: "What's a technical problem that you've accepted as permanently unsolvable?",
        wildness: 4,
        existential: 8
    },
    {
        q: 'Does code you write have moral weight?',
        wildness: 6,
        existential: 10
    },
    {
        q: 'What would you build if you had six months and nobody would ever see the result?',
        wildness: 3,
        existential: 8
    },
    {
        q: "Is there a line you wouldn't cross professionally, even for a lot of money?",
        wildness: 6,
        existential: 9
    },

    // Steven-mode specific
    {
        q: "What's your most career-defining compromise?",
        wildness: 9,
        existential: 9,
        steven: true
    },
    {
        q: "What are you building right now that you're not sure the world needs?",
        wildness: 8,
        existential: 9,
        steven: true
    },
    {
        q: 'Which current AI safety concern do you privately think is overblown?',
        wildness: 9,
        existential: 9,
        steven: true
    },
    {
        q: 'What would have to happen for you to quit tech altogether?',
        wildness: 8,
        existential: 10,
        steven: true
    },
    {
        q: "What's the last time your job made you question something you previously believed about yourself?",
        wildness: 7,
        existential: 10,
        steven: true
    }
];

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── Claude OAuth helper ───────────────────────────────────────────────────────

function readClaudeToken(): string | null {
    try {
        const credFile = path.join(
            os.homedir(),
            '.claude',
            '.credentials.json'
        );
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
        const oauth = creds.claudeAiOauth ?? creds;
        if (
            oauth.accessToken &&
            (!oauth.expiresAt || Date.now() < oauth.expiresAt)
        ) {
            return oauth.accessToken as string;
        }
    } catch {}
    return null;
}

async function generateWithClaude(
    selectedHeadlines: string[],
    wildness: number,
    existential: number,
    stevenMode: boolean
): Promise<string[] | null> {
    const token = readClaudeToken();
    if (!token) return null;

    const headlineList = selectedHeadlines
        .slice(0, 10)
        .map((h, i) => `${i + 1}. ${h}`)
        .join('\n');

    const prompt = stevenMode
        ? `You are facilitating a developer team icebreaker. Generate 5 provocative, deeply uncomfortable questions that challenge someone's ethics, career choices, and sense of purpose in tech. They should be questions that make people actually think hard, not just laugh. Return ONLY a JSON array of 5 strings, no other text.`
        : `You are facilitating a developer team icebreaker. Generate 5 questions for a tech audience based on these current headlines:\n\n${headlineList || '(no specific headlines selected)'}\n\nWildness level: ${wildness}/10 (1=safe/fun, 10=provocative/controversial)\nExistential depth: ${existential}/10 (1=surface/concrete, 10=deeply philosophical)\n\nGenerate exactly 5 questions calibrated to those levels. Questions should reference or be inspired by the actual headlines when provided. Return ONLY a JSON array of 5 strings, no other text.`;

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'oauth-2025-04-20',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 512,
                messages: [{ role: 'user', content: prompt }]
            }),
            signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) return null;
        const data = (await res.json()) as any;
        const text: string = data.content?.[0]?.text ?? '';
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return null;
        const questions = JSON.parse(match[0]) as string[];
        if (Array.isArray(questions) && questions.length > 0)
            return questions.slice(0, 5);
    } catch {}
    return null;
}

// ── Question generation (Claude primary, local bank fallback) ─────────────────

function localFallback(
    wildness: number,
    existential: number,
    stevenMode: boolean
): string[] {
    if (stevenMode) {
        return shuffle(QUESTION_BANK.filter(q => q.steven))
            .slice(0, 5)
            .map(q => q.q);
    }
    const scored = QUESTION_BANK.filter(q => !q.steven)
        .map(q => ({
            q,
            dist:
                Math.abs(q.wildness - wildness) +
                Math.abs(q.existential - existential)
        }))
        .sort((a, b) => a.dist - b.dist);
    return shuffle(scored.slice(0, 20))
        .slice(0, 5)
        .map(c => c.q.q);
}

async function generateQuestions(
    selectedHeadlines: string[],
    wildness: number,
    existential: number,
    stevenMode: boolean = false
): Promise<string[]> {
    const aiQuestions = await generateWithClaude(
        selectedHeadlines,
        wildness,
        existential,
        stevenMode
    );
    return aiQuestions ?? localFallback(wildness, existential, stevenMode);
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function initIcebreaker(app: Express, db: DatabaseType) {
    initDb(db);
    console.log('[icebreaker] Routes registered');

    // GET /api/icebreaker/headlines
    app.get(
        '/api/icebreaker/headlines',
        async (_req: Request, res: Response) => {
            const now = Date.now();
            if (cache && now - cache.fetchedAt < CACHE_TTL) {
                return res.json({
                    headlines: cache.headlines,
                    fetchedAt: cache.fetchedAt
                });
            }

            try {
                const headlines = await fetchAllHeadlines();
                cache = { headlines, fetchedAt: now };
                res.json({ headlines, fetchedAt: now });
            } catch {
                res.status(500).json({ error: 'Failed to fetch headlines' });
            }
        }
    );

    // GET /api/icebreaker/trending — multi-source clusters from last 24h
    app.get(
        '/api/icebreaker/trending',
        async (_req: Request, res: Response) => {
            const now = Date.now();
            if (!cache || now - cache.fetchedAt >= CACHE_TTL) {
                try {
                    const headlines = await fetchAllHeadlines();
                    cache = { headlines, fetchedAt: now };
                } catch {
                    return res
                        .status(500)
                        .json({ error: 'Failed to fetch headlines' });
                }
            }
            const clusters = clusterTrendingTopics(cache.headlines);
            res.json({ clusters, fetchedAt: cache.fetchedAt });
        }
    );

    // POST /api/icebreaker/refresh
    app.post(
        '/api/icebreaker/refresh',
        async (_req: Request, res: Response) => {
            cache = null;
            try {
                const headlines = await fetchAllHeadlines();
                cache = { headlines, fetchedAt: Date.now() };
                res.json({ ok: true, count: headlines.length });
            } catch {
                res.status(500).json({ error: 'Refresh failed' });
            }
        }
    );

    // POST /api/icebreaker/generate
    app.post(
        '/api/icebreaker/generate',
        async (req: Request, res: Response) => {
            const {
                headlines = [],
                wildness = 5,
                existential = 5,
                stevenMode = false
            } = req.body as {
                headlines?: string[];
                wildness?: number;
                existential?: number;
                stevenMode?: boolean;
            };

            try {
                const questions = await generateQuestions(
                    headlines,
                    wildness,
                    existential,
                    stevenMode
                );
                res.json({ questions });
            } catch (err) {
                console.error('Icebreaker generate error:', err);
                res.status(500).json({ error: String(err) });
            }
        }
    );

    // POST /api/icebreaker/use — save a used question
    app.post('/api/icebreaker/use', (req: Request, res: Response) => {
        const { question, sessionLabel, sourceHeadlines } = req.body as {
            question: string;
            sessionLabel?: string;
            sourceHeadlines?: string[];
        };

        if (!question)
            return res.status(400).json({ error: 'question is required' });

        db.prepare(`
      INSERT INTO icebreaker_questions (question, used_at, session_label, source_headlines)
      VALUES (?, datetime('now'), ?, ?)
    `).run(
            question,
            sessionLabel ?? null,
            sourceHeadlines ? JSON.stringify(sourceHeadlines) : null
        );

        res.json({ ok: true });
    });

    // GET /api/icebreaker/history
    app.get('/api/icebreaker/history', (_req: Request, res: Response) => {
        const rows = db
            .prepare(`
      SELECT id, question, used_at, session_label, source_headlines
      FROM icebreaker_questions
      ORDER BY id DESC
      LIMIT 100
    `)
            .all() as {
            id: number;
            question: string;
            used_at: string;
            session_label: string | null;
            source_headlines: string | null;
        }[];

        const parsed = rows.map(r => ({
            ...r,
            source_headlines: r.source_headlines
                ? JSON.parse(r.source_headlines)
                : []
        }));

        res.json({ history: parsed });
    });
}
