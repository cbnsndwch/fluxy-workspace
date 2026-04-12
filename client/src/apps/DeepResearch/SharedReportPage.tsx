import { Loader2, BookOpen, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams } from 'react-router';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import type { JSX } from 'react';

interface Heading {
    level: number;
    text: string;
    id: string;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-');
}

function extractHeadings(markdown: string): Heading[] {
    const lines = markdown.split('\n');
    const result: Heading[] = [];
    const counts: Record<string, number> = {};
    for (const line of lines) {
        const m = line.match(/^(#{1,4})\s+(.+)$/);
        if (!m) continue;
        const level = m[1].length;
        const text = m[2].trim();
        const base = slugify(text);
        counts[base] = (counts[base] ?? 0) + 1;
        const id = counts[base] > 1 ? `${base}-${counts[base] - 1}` : base;
        result.push({ level, text, id });
    }
    return result;
}

function makeHeadingComponent(level: number) {
    const counts: Record<string, number> = {};
    return ({ children, ...props }: any) => {
        const text = String(children);
        const base = slugify(text);
        counts[base] = (counts[base] ?? 0) + 1;
        const id = counts[base] > 1 ? `${base}-${counts[base] - 1}` : base;
        const Tag = `h${level}` as keyof JSX.IntrinsicElements;
        return (
            <Tag id={id} {...props}>
                {children}
            </Tag>
        );
    };
}

const headingComponents = {
    h1: makeHeadingComponent(1),
    h2: makeHeadingComponent(2),
    h3: makeHeadingComponent(3),
    h4: makeHeadingComponent(4)
};

function TableOfContents({
    headings,
    activeId
}: {
    headings: Heading[];
    activeId: string | null;
}) {
    if (headings.length < 3) return null;
    return (
        <nav className="hidden xl:block w-56 shrink-0">
            <div className="sticky top-8">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
                    On this page
                </p>
                <ul className="space-y-1">
                    {headings
                        .filter(h => h.level <= 3)
                        .map(h => (
                            <li key={h.id}>
                                <a
                                    href={`#${h.id}`}
                                    className={cn(
                                        'block text-xs leading-relaxed transition-colors cursor-pointer',
                                        h.level === 1
                                            ? 'pl-0 font-medium'
                                            : h.level === 2
                                              ? 'pl-3'
                                              : 'pl-6',
                                        activeId === h.id
                                            ? 'text-gray-900 font-medium'
                                            : 'text-gray-400 hover:text-gray-700'
                                    )}
                                >
                                    {h.text}
                                </a>
                            </li>
                        ))}
                </ul>
            </div>
        </nav>
    );
}

export default function SharedReportPage() {
    const { token } = useParams<{ token: string }>();
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        fetch(`/app/api/research/public/${token}`)
            .then(r => {
                if (!r.ok) throw new Error();
                return r.json();
            })
            .then(setData)
            .catch(() => setError(true));
    }, [token]);

    // Intersection observer for active heading
    useEffect(() => {
        if (!data) return;
        const observer = new IntersectionObserver(
            entries => {
                const visible = entries.filter(e => e.isIntersecting);
                if (visible.length > 0) {
                    setActiveId(visible[0].target.id);
                }
            },
            { rootMargin: '0px 0px -70% 0px', threshold: 0 }
        );
        document
            .querySelectorAll('h1[id], h2[id], h3[id], h4[id]')
            .forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [data]);

    if (error) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">
                        This report is no longer available or the link has
                        expired.
                    </p>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-gray-300 animate-spin" />
            </div>
        );
    }

    const { topic, session, report, findings, reportSettings } = data;
    const rs = reportSettings as any;
    const hasBranding = rs && rs.company_name;
    const headings = extractHeadings(report.content);
    const uniqueSources = (findings as any[]).filter(
        (f, i, arr) =>
            f.source_url &&
            arr.findIndex((x: any) => x.source_url === f.source_url) === i
    );

    const fmtDate = (s: string) =>
        new Date(s + 'Z').toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

    const copyrightLine = hasBranding
        ? `\u00A9 ${new Date().getFullYear()} ${rs.company_name}. All rights reserved.`
        : '';
    const preparedFor = topic.prepared_for?.trim();

    return (
        <div className="min-h-screen bg-white text-gray-900 flex flex-col">
            {/* Header — company branded or generic */}
            <header className="border-b border-gray-100 px-6 py-4">
                <div className="max-w-5xl mx-auto flex items-center gap-3">
                    {hasBranding && rs.logo_url ? (
                        <img
                            src={rs.logo_url}
                            alt={rs.company_name}
                            className="h-6 max-w-[140px] object-contain"
                        />
                    ) : hasBranding ? (
                        <span className="text-sm font-bold uppercase tracking-wider text-gray-600">
                            {rs.company_name}
                        </span>
                    ) : (
                        <BookOpen className="h-4 w-4 text-orange-500" />
                    )}
                    <div className="flex flex-col">
                        {hasBranding && rs.logo_url && (
                            <span className="text-sm font-semibold text-gray-700">
                                {rs.company_name}
                            </span>
                        )}
                        {!hasBranding && (
                            <span className="text-sm font-semibold text-gray-700">
                                Deep Research
                            </span>
                        )}
                        {hasBranding && rs.tagline && (
                            <span className="text-[10px] text-gray-400">
                                {rs.tagline}
                            </span>
                        )}
                    </div>
                </div>
            </header>

            {/* Main layout */}
            <div className="flex-1 max-w-5xl mx-auto px-6 py-10 flex gap-12 w-full">
                {/* Report content */}
                <div className="flex-1 min-w-0">
                    {/* Prepared-for callout */}
                    {preparedFor && (
                        <div className="mb-6 text-center">
                            <span className="text-[10px] uppercase tracking-widest text-gray-400">
                                Prepared for
                            </span>
                            <p className="text-lg font-semibold text-gray-700 mt-1">
                                {preparedFor}
                            </p>
                        </div>
                    )}

                    {/* Topic header */}
                    <div className="mb-8 pb-6 border-b border-gray-100">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2 leading-tight">
                            {topic.title}
                        </h1>
                        {topic.description && (
                            <p className="text-gray-500 text-base">
                                {topic.description}
                            </p>
                        )}
                        {session.completed_at && (
                            <p className="text-xs text-gray-400 mt-3">
                                Researched {fmtDate(session.completed_at)}
                            </p>
                        )}
                    </div>

                    {/* Report body */}
                    <div
                        className={cn(
                            'prose max-w-none',
                            '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-0 [&_h1]:leading-tight [&_h1]:text-gray-900',
                            '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:leading-snug [&_h2]:text-gray-900',
                            '[&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-gray-100',
                            '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-gray-900',
                            '[&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-gray-900',
                            '[&_p]:text-[15px] [&_p]:leading-[1.8] [&_p]:mb-4 [&_p]:text-gray-700',
                            '[&_ul]:text-[15px] [&_ul]:leading-[1.8] [&_ul]:mb-4 [&_ul]:pl-6 [&_ul]:text-gray-700',
                            '[&_ol]:text-[15px] [&_ol]:leading-[1.8] [&_ol]:mb-4 [&_ol]:pl-6 [&_ol]:text-gray-700',
                            '[&_li]:mb-2',
                            '[&_strong]:font-semibold [&_strong]:text-gray-900',
                            '[&_em]:italic [&_em]:text-gray-600',
                            '[&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2',
                            '[&_code]:text-[13px] [&_code]:bg-gray-100 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono',
                            '[&_pre]:bg-gray-50 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre]:border [&_pre]:border-gray-200',
                            '[&_blockquote]:border-l-3 [&_blockquote]:border-gray-200 [&_blockquote]:pl-4 [&_blockquote]:text-gray-500 [&_blockquote]:italic [&_blockquote]:my-4',
                            '[&_hr]:border-gray-100 [&_hr]:my-6',
                            '[&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4',
                            '[&_th]:text-left [&_th]:font-semibold [&_th]:py-2 [&_th]:px-3 [&_th]:border-b-2 [&_th]:border-gray-200',
                            '[&_td]:py-2 [&_td]:px-3 [&_td]:border-b [&_td]:border-gray-100',
                            // Superscript citations
                            '[&_sup]:text-[10px] [&_sup]:leading-none',
                            '[&_sup_a]:text-blue-600 [&_sup_a]:no-underline [&_sup_a]:font-semibold [&_sup_a]:hover:underline'
                        )}
                    >
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                            components={headingComponents as any}
                        >
                            {report.content}
                        </ReactMarkdown>
                    </div>

                    {/* Sources */}
                    {uniqueSources.length > 0 && (
                        <div className="mt-10 pt-6 border-t border-gray-100">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-4">
                                Sources
                            </p>
                            <div className="space-y-2">
                                {uniqueSources.map((f: any, i: number) => (
                                    <a
                                        key={f.id}
                                        id={`ref-${i + 1}`}
                                        href={f.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-start gap-2 text-sm text-gray-400 hover:text-blue-600 transition-colors cursor-pointer scroll-mt-8"
                                    >
                                        <span className="shrink-0 text-gray-300 mt-0.5">
                                            {i + 1}.
                                        </span>
                                        <span className="line-clamp-1">
                                            {f.source_title || f.source_url}
                                        </span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ToC sidebar */}
                <TableOfContents headings={headings} activeId={activeId} />
            </div>

            {/* Footer — copyright & confidentiality */}
            {hasBranding && (
                <footer className="border-t border-gray-100 px-6 py-6 mt-auto">
                    <div className="max-w-5xl mx-auto text-center space-y-1">
                        <p className="text-xs font-semibold text-gray-500">
                            {copyrightLine}
                        </p>
                        {rs.confidentiality_notice && (
                            <p className="text-[10px] text-gray-400 italic max-w-xl mx-auto">
                                {rs.confidentiality_notice}
                            </p>
                        )}
                        <p className="text-[10px] text-gray-400">
                            {[rs.company_name, rs.website, rs.contact_email]
                                .filter(Boolean)
                                .join(' \u2022 ')}
                        </p>
                    </div>
                </footer>
            )}
        </div>
    );
}
