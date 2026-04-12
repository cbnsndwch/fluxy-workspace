import crypto from 'crypto';
import fs from 'fs';
import { marked, type Token } from 'marked';
import path from 'path';

// Lazy-loaded pdfmake instance (CJS module, loaded on first use)
let _pdfmake: any = null;
async function getPdfMake() {
    if (_pdfmake) return _pdfmake;
    // @ts-ignore - pdfmake CJS default export
    const mod = await import('pdfmake');
    _pdfmake = mod.default || mod;
    // @ts-ignore - vfs_fonts CJS
    const vfsMod = await import('pdfmake/build/vfs_fonts.js');
    const vfsFonts = vfsMod.default || vfsMod;
    // Convert base64 font strings to Buffers
    for (const [key, value] of Object.entries(vfsFonts)) {
        if (typeof value === 'string') {
            _pdfmake.virtualfs.storage[key] = Buffer.from(value, 'base64');
        }
    }
    _pdfmake.setFonts({
        Roboto: {
            normal: 'Roboto-Regular.ttf',
            bold: 'Roboto-Medium.ttf',
            italics: 'Roboto-Italic.ttf',
            bolditalics: 'Roboto-MediumItalic.ttf'
        }
    });
    return _pdfmake;
}

interface ReportSettings {
    company_name?: string;
    tagline?: string;
    logo_url?: string;
    website?: string;
    contact_email?: string;
    confidentiality_notice?: string;
}

interface PdfInput {
    topic: { title: string; prepared_for?: string };
    report: { content: string; id: number };
    findings: { source_url?: string; source_title?: string }[];
    settings: ReportSettings | null;
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'pdf-exports');

function getCachePath(reportId: number, settingsHash: string): string {
    return path.join(CACHE_DIR, `report-${reportId}-${settingsHash}.pdf`);
}

function hashSettings(
    settings: ReportSettings | null,
    topic: { prepared_for?: string },
    content: string
): string {
    const data = JSON.stringify({
        settings,
        pf: topic.prepared_for,
        len: content.length
    });
    return crypto.createHash('md5').update(data).digest('hex').slice(0, 8);
}

// ── Markdown → pdfmake content conversion ─────────────────────────────────

function mdToPdfContent(markdown: string): any[] {
    const tokens = marked.lexer(markdown);
    return tokensToPdf(tokens);
}

function tokensToPdf(tokens: Token[]): any[] {
    const content: any[] = [];

    for (const token of tokens) {
        switch (token.type) {
            case 'heading': {
                const sizes: Record<number, number> = {
                    1: 20,
                    2: 16,
                    3: 14,
                    4: 13,
                    5: 12,
                    6: 11
                };
                content.push({
                    text: inlineTokensToPdf(token.tokens || []),
                    fontSize: sizes[token.depth] || 12,
                    bold: true,
                    color: '#1a1a1a',
                    margin: [0, token.depth <= 2 ? 18 : 12, 0, 6]
                });
                // Add a thin line under h2
                if (token.depth === 2) {
                    content.push({
                        canvas: [
                            {
                                type: 'line',
                                x1: 0,
                                y1: 0,
                                x2: 460,
                                y2: 0,
                                lineWidth: 0.5,
                                lineColor: '#e5e5e5'
                            }
                        ],
                        margin: [0, 0, 0, 8]
                    });
                }
                break;
            }
            case 'paragraph':
                content.push({
                    text: inlineTokensToPdf(token.tokens || []),
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    color: '#1a1a1a',
                    margin: [0, 0, 0, 8]
                });
                break;

            case 'list': {
                const items = token.items.map((item: any) => {
                    // Each list item can contain paragraphs and nested lists
                    const itemContent: any[] = [];
                    for (const child of item.tokens || []) {
                        if (
                            child.type === 'text' ||
                            child.type === 'paragraph'
                        ) {
                            itemContent.push({
                                text: inlineTokensToPdf(child.tokens || []),
                                fontSize: 10.5,
                                lineHeight: 1.4,
                                color: '#1a1a1a'
                            });
                        } else if (child.type === 'list') {
                            // Nested list
                            const nested = child.items.map((ni: any) => ({
                                text: inlineTokensToPdf(
                                    ni.tokens?.[0]?.tokens || []
                                ),
                                fontSize: 10,
                                lineHeight: 1.3,
                                color: '#333'
                            }));
                            itemContent.push({
                                [child.ordered ? 'ol' : 'ul']: nested,
                                margin: [0, 2, 0, 2]
                            });
                        }
                    }
                    return itemContent.length === 1
                        ? itemContent[0]
                        : { stack: itemContent };
                });
                content.push({
                    [token.ordered ? 'ol' : 'ul']: items,
                    margin: [0, 0, 0, 8]
                });
                break;
            }

            case 'blockquote':
                content.push({
                    stack: tokensToPdf(token.tokens || []),
                    margin: [16, 4, 0, 8],
                    border: [true, false, false, false],
                    borderColor: ['#d1d5db', '#fff', '#fff', '#fff'],
                    color: '#6b7280',
                    italics: true,
                    fontSize: 10.5
                });
                break;

            case 'code':
                content.push({
                    text: token.text,
                    fontSize: 9,
                    background: '#f3f4f6',
                    color: '#1a1a1a',
                    margin: [0, 4, 0, 10],
                    lineHeight: 1.35,
                    preserveLeadingSpaces: true
                });
                break;

            case 'hr':
                content.push({
                    canvas: [
                        {
                            type: 'line',
                            x1: 0,
                            y1: 0,
                            x2: 460,
                            y2: 0,
                            lineWidth: 0.5,
                            lineColor: '#e5e5e5'
                        }
                    ],
                    margin: [0, 12, 0, 12]
                });
                break;

            case 'table': {
                const headerRow = token.header.map((cell: any) => ({
                    text: inlineTokensToPdf(cell.tokens || []),
                    bold: true,
                    fontSize: 9,
                    color: '#374151',
                    fillColor: '#f9fafb',
                    margin: [4, 6, 4, 6]
                }));
                const bodyRows = token.rows.map((row: any) =>
                    row.map((cell: any) => ({
                        text: inlineTokensToPdf(cell.tokens || []),
                        fontSize: 9,
                        color: '#4b5563',
                        margin: [4, 4, 4, 4]
                    }))
                );
                content.push({
                    table: {
                        headerRows: 1,
                        widths: Array(token.header.length).fill('*'),
                        body: [headerRow, ...bodyRows]
                    },
                    layout: {
                        hLineWidth: () => 0.5,
                        vLineWidth: () => 0,
                        hLineColor: () => '#e5e5e5'
                    },
                    margin: [0, 4, 0, 10]
                });
                break;
            }

            case 'space':
                break;

            default:
                // Fallback: try to extract text
                if ('text' in token && typeof token.text === 'string') {
                    content.push({
                        text: token.text,
                        fontSize: 10.5,
                        lineHeight: 1.5,
                        color: '#1a1a1a',
                        margin: [0, 0, 0, 8]
                    });
                }
        }
    }

    return content;
}

function inlineTokensToPdf(tokens: Token[]): any[] {
    const parts: any[] = [];

    for (const t of tokens) {
        switch (t.type) {
            case 'text':
                // Handle nested tokens within text (e.g. bold inside text)
                if ('tokens' in t && t.tokens) {
                    parts.push(...inlineTokensToPdf(t.tokens as Token[]));
                } else {
                    parts.push({ text: t.text });
                }
                break;
            case 'strong':
                parts.push({
                    text: inlineTokensToPdf(t.tokens || []),
                    bold: true
                });
                break;
            case 'em':
                parts.push({
                    text: inlineTokensToPdf(t.tokens || []),
                    italics: true
                });
                break;
            case 'codespan':
                parts.push({
                    text: t.text,
                    fontSize: 9,
                    background: '#f3f4f6',
                    color: '#c7254e'
                });
                break;
            case 'link':
                parts.push({
                    text: inlineTokensToPdf(t.tokens || []),
                    color: '#2563eb',
                    decoration: 'underline',
                    link: t.href
                });
                break;
            case 'html': {
                // Handle <sup> citation tags like <sup><a href="#ref-1">[1]</a></sup>
                const supMatch = t.raw?.match(/\[(\d+)\]/);
                if (supMatch) {
                    parts.push({
                        text: `[${supMatch[1]}]`,
                        fontSize: 7,
                        sup: true,
                        color: '#2563eb',
                        bold: true
                    });
                } else if (t.text) {
                    parts.push({ text: t.text });
                }
                break;
            }
            case 'br':
                parts.push({ text: '\n' });
                break;
            default:
                if ('text' in t && typeof t.text === 'string') {
                    parts.push({ text: t.text });
                }
        }
    }

    return parts;
}

// ── PDF generation ─────────────────────────────────────────────────────────

export async function generatePdf(input: PdfInput): Promise<Buffer> {
    const { topic, report, findings, settings } = input;

    // Check cache
    const sHash = hashSettings(settings, topic, report.content);
    const cachePath = getCachePath(report.id, sHash);
    if (fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath);
    }

    const rs = settings;
    const hasBranding = rs && rs.company_name;
    const copyrightYear = new Date().getFullYear();
    const copyrightLine = hasBranding
        ? `© ${copyrightYear} ${rs.company_name}. All rights reserved.`
        : '';
    const preparedFor = topic.prepared_for?.trim();

    // ── Build document content ──

    const docContent: any[] = [];

    // Company header
    if (hasBranding) {
        docContent.push({
            text: rs.company_name!.toUpperCase(),
            fontSize: 11,
            bold: true,
            color: '#374151',
            letterSpacing: 1.5,
            alignment: 'center',
            margin: [0, 0, 0, 2]
        });
        if (rs.tagline) {
            docContent.push({
                text: rs.tagline,
                fontSize: 9,
                color: '#9ca3af',
                alignment: 'center',
                margin: [0, 0, 0, 8]
            });
        }
    }

    // Prepared for
    if (preparedFor) {
        docContent.push({
            text: 'Prepared for',
            fontSize: 9,
            color: '#9ca3af',
            alignment: 'center',
            margin: [0, hasBranding ? 4 : 0, 0, 2]
        });
        docContent.push({
            text: preparedFor,
            fontSize: 14,
            bold: true,
            color: '#374151',
            alignment: 'center',
            margin: [0, 0, 0, 8]
        });
    }

    // Divider
    if (hasBranding || preparedFor) {
        docContent.push({
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 460,
                    y2: 0,
                    lineWidth: 1.5,
                    lineColor: '#e5e5e5'
                }
            ],
            margin: [0, 4, 0, 16]
        });
    }

    // Date
    docContent.push({
        text: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        fontSize: 9,
        color: '#9ca3af',
        margin: [0, 0, 0, 4]
    });

    // Title
    docContent.push({
        text: topic.title,
        fontSize: 22,
        bold: true,
        color: '#1a1a1a',
        margin: [0, 0, 0, 20],
        lineHeight: 1.2
    });

    // Main content (markdown → pdfmake)
    docContent.push(...mdToPdfContent(report.content));

    // ── Sources section ──
    const uniqueSources =
        findings?.filter(
            (f, i, arr) =>
                f.source_url &&
                arr.findIndex(x => x.source_url === f.source_url) === i
        ) ?? [];

    if (uniqueSources.length > 0) {
        docContent.push({
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 460,
                    y2: 0,
                    lineWidth: 1.5,
                    lineColor: '#e5e5e5'
                }
            ],
            margin: [0, 24, 0, 12]
        });
        docContent.push({
            text: 'SOURCES & REFERENCES',
            fontSize: 9,
            bold: true,
            color: '#9ca3af',
            letterSpacing: 1,
            margin: [0, 0, 0, 8]
        });
        for (let i = 0; i < uniqueSources.length; i++) {
            const src = uniqueSources[i];
            docContent.push({
                text: [
                    { text: `${i + 1}. `, color: '#d1d5db', fontSize: 9 },
                    {
                        text: src.source_title || src.source_url || '',
                        color: '#6b7280',
                        fontSize: 9,
                        link: src.source_url || undefined,
                        decoration: src.source_url ? 'underline' : undefined
                    }
                ],
                margin: [0, 0, 0, 3]
            });
        }
    }

    // ── Footer block (in-body) ──
    if (hasBranding) {
        docContent.push({
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 460,
                    y2: 0,
                    lineWidth: 1.5,
                    lineColor: '#e5e5e5'
                }
            ],
            margin: [0, 32, 0, 12]
        });
        docContent.push({
            text: copyrightLine,
            fontSize: 9,
            bold: true,
            color: '#374151',
            alignment: 'center',
            margin: [0, 0, 0, 4]
        });
        if (rs.confidentiality_notice) {
            docContent.push({
                text: rs.confidentiality_notice,
                fontSize: 8,
                color: '#9ca3af',
                italics: true,
                alignment: 'center',
                margin: [0, 0, 0, 4]
            });
        }
        const contactParts = [
            rs.company_name,
            rs.website,
            rs.contact_email
        ].filter(Boolean);
        if (contactParts.length > 0) {
            docContent.push({
                text: contactParts.join(' • '),
                fontSize: 8,
                color: '#9ca3af',
                alignment: 'center',
                margin: [0, 0, 0, 0]
            });
        }
    }

    // ── pdfmake document definition ──

    const headerLeft = hasBranding
        ? `${rs.company_name}${rs.tagline ? ` — ${rs.tagline}` : ''}`
        : '';
    const headerRight = preparedFor ? `Prepared for ${preparedFor}` : '';

    const docDefinition: any = {
        pageSize: 'LETTER',
        pageMargins: [50, hasBranding || preparedFor ? 50 : 40, 50, 45],
        defaultStyle: {
            font: 'Roboto',
            fontSize: 10.5,
            lineHeight: 1.5
        },

        // Per-page header
        header: (currentPage: number) => {
            if (currentPage === 1) return null; // No header on cover/first page
            return {
                columns: [
                    {
                        text: headerLeft,
                        fontSize: 7.5,
                        color: '#9ca3af',
                        bold: true,
                        alignment: 'left'
                    },
                    {
                        text: headerRight,
                        fontSize: 7.5,
                        color: '#9ca3af',
                        alignment: 'right'
                    }
                ],
                margin: [50, 20, 50, 0]
            };
        },

        // Per-page footer with branding + page numbers
        footer: (currentPage: number, pageCount: number) => {
            const footerParts: string[] = [];
            if (copyrightLine) footerParts.push(copyrightLine);
            if (hasBranding && rs.confidentiality_notice) {
                const notice =
                    rs.confidentiality_notice.length > 80
                        ? rs.confidentiality_notice.slice(0, 77) + '...'
                        : rs.confidentiality_notice;
                footerParts.push(notice);
            }

            return {
                columns: [
                    {
                        text: footerParts.join(' · '),
                        fontSize: 7,
                        color: '#b0b0b0',
                        alignment: 'left'
                    },
                    {
                        text: `Page ${currentPage} of ${pageCount}`,
                        fontSize: 7,
                        color: '#b0b0b0',
                        alignment: 'right'
                    }
                ],
                margin: [50, 10, 50, 0]
            };
        },

        content: docContent
    };

    // ── Generate PDF buffer ──

    const pdfmake = await getPdfMake();
    const pdfDoc = pdfmake.createPdf(docDefinition);
    const pdfBuffer: Buffer = Buffer.from(await pdfDoc.getBuffer());

    // Cache to disk
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, pdfBuffer);

    return pdfBuffer;
}
