import { useEffect, useState, useCallback } from 'react';
import { useLoaderData } from 'react-router';
import { ChevronRight, Database, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppLayout } from '@/components/ui/app-layout';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ColInfo {
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: string | null;
}

interface TableInfo {
    name: string;
    rowCount: number;
    columns: ColInfo[];
}

type Row = Record<string, unknown>;

// ── Row Edit Modal ─────────────────────────────────────────────────────────────
function RowModal({
    table,
    columns,
    row,
    onClose,
    onSave
}: {
    table: string;
    columns: ColInfo[];
    row: Row | null;
    onClose: () => void;
    onSave: () => void;
}) {
    const isNew = !row;
    const editableCols =
        columns.filter(c => (!c.pk || isNew ? false : false)).length === 0
            ? columns.filter(
                  c =>
                      c.name !== 'id' &&
                      c.name !== 'created_at' &&
                      c.name !== 'updated_at'
              )
            : columns.filter(
                  c =>
                      c.name !== 'id' &&
                      c.name !== 'created_at' &&
                      c.name !== 'updated_at'
              );

    const [form, setForm] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        for (const col of editableCols) {
            init[col.name] = row ? String(row[col.name] ?? '') : '';
        }
        return init;
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const url = isNew
                ? `/app/api/db/${encodeURIComponent(table)}/rows`
                : `/app/api/db/${encodeURIComponent(table)}/rows/${(row as Row)['id']}`;
            const method = isNew ? 'POST' : 'PUT';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            });
            if (!res.ok) {
                const err = await res.json();
                setError(err.error || 'Failed to save');
                return;
            }
            onSave();
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {isNew ? `New row in ${table}` : `Edit row`}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 pt-2">
                    {editableCols.map(col => (
                        <div key={col.name} className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                {col.name}
                                <span className="text-[10px] text-muted-foreground/60 font-normal">
                                    {col.type}
                                </span>
                                {col.notnull ? (
                                    <span className="text-red-500 text-[10px]">
                                        required
                                    </span>
                                ) : null}
                            </label>
                            <Input
                                value={form[col.name] ?? ''}
                                onChange={e =>
                                    setForm(f => ({
                                        ...f,
                                        [col.name]: e.target.value
                                    }))
                                }
                                placeholder={
                                    col.dflt_value
                                        ? `default: ${col.dflt_value}`
                                        : undefined
                                }
                                className="h-8 text-sm font-mono"
                            />
                        </div>
                    ))}
                    {error && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : isNew ? 'Insert' : 'Save'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────
function DeleteConfirm({
    table,
    row,
    onClose,
    onDeleted
}: {
    table: string;
    row: Row;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Delete row?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                    Row id={String(row['id'])} in{' '}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {table}
                    </code>{' '}
                    will be permanently deleted.
                </p>
                {error && <p className="text-xs text-destructive">{error}</p>}
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
                            const res = await fetch(
                                `/app/api/db/${encodeURIComponent(table)}/rows/${row['id']}`,
                                { method: 'DELETE' }
                            );
                            if (!res.ok) {
                                const e = await res.json();
                                setError(e.error || 'Failed');
                                setDeleting(false);
                                return;
                            }
                            onDeleted();
                        }}
                    >
                        {deleting ? 'Deleting…' : 'Delete'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Loader ─────────────────────────────────────────────────────────────────────
export async function loader(): Promise<TableInfo[]> {
    const res = await fetch('/app/api/db/tables');
    return res.json();
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function DBViewerPage() {
    const initialTables = useLoaderData() as TableInfo[];
    const [tables, setTables] = useState<TableInfo[]>(initialTables);
    const [selectedTable, setSelectedTable] = useState<string | null>(initialTables[0]?.name ?? null);
    const [rows, setRows] = useState<Row[]>([]);
    const [page, setPage] = useState(0);
    const [totalRows, setTotalRows] = useState(0);
    const [loadingTables, setLoadingTables] = useState(false);
    const [loadingRows, setLoadingRows] = useState(false);
    const [editRow, setEditRow] = useState<Row | 'new' | null>(null);
    const [deleteRow, setDeleteRow] = useState<Row | null>(null);
    const PAGE_SIZE = 50;

    const loadTables = useCallback(async () => {
        setLoadingTables(true);
        const res = await fetch('/app/api/db/tables');
        const data = await res.json();
        setTables(data);
        setLoadingTables(false);
        if (data.length > 0 && !selectedTable) setSelectedTable(data[0].name);
    }, [selectedTable]);

    const loadRows = useCallback(async (tableName: string, pg: number) => {
        setLoadingRows(true);
        const res = await fetch(
            `/app/api/db/${encodeURIComponent(tableName)}/rows?page=${pg}&limit=${PAGE_SIZE}`
        );
        const data = await res.json();
        setRows(data.rows);
        setTotalRows(data.total);
        setLoadingRows(false);
    }, []);

    useEffect(() => {
        if (selectedTable) {
            setPage(0);
            loadRows(selectedTable, 0);
        }
    }, [selectedTable, loadRows]);

    const currentTableInfo = tables.find(t => t.name === selectedTable);
    const columns = currentTableInfo?.columns ?? [];
    const totalPages = Math.ceil(totalRows / PAGE_SIZE);

    const refresh = () => {
        loadTables();
        if (selectedTable) loadRows(selectedTable, page);
    };

    return (
        <AppLayout
            icon={<Database size={20} />}
            iconClassName="bg-emerald-500/10 text-emerald-500"
            title="DB Viewer"
            subtitle={tables.length > 0 ? `${tables.length} tables · app.db` : 'app.db'}
        >
        <div className="flex h-full overflow-hidden">
            {/* Sidebar */}
            <aside className="w-56 shrink-0 border-r border-border/50 bg-sidebar flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto py-1">
                    {loadingTables ? (
                        <div className="px-4 py-2 text-xs text-muted-foreground">
                            Loading…
                        </div>
                    ) : (
                        tables.map(t => (
                            <button
                                key={t.name}
                                onClick={() => setSelectedTable(t.name)}
                                className={cn(
                                    'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors cursor-pointer hover:bg-sidebar-accent/50 group',
                                    selectedTable === t.name
                                        ? 'bg-sidebar-accent text-foreground font-medium'
                                        : 'text-muted-foreground'
                                )}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {selectedTable === t.name && (
                                        <ChevronRight className="h-3 w-3 shrink-0 text-primary" />
                                    )}
                                    <span className="truncate font-mono text-xs">
                                        {t.name}
                                    </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-1">
                                    {t.rowCount}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedTable ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                        Select a table
                    </div>
                ) : (
                    <>
                        {/* Table header */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
                            <div>
                                <span className="font-mono text-sm font-medium">
                                    {selectedTable}
                                </span>
                                <span className="text-xs text-muted-foreground ml-2">
                                    {totalRows} rows · {columns.length} columns
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={refresh}
                                    className="h-7 gap-1.5 text-xs"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Refresh
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => setEditRow('new')}
                                    className="h-7 gap-1.5 text-xs"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add row
                                </Button>
                            </div>
                        </div>

                        {/* Data grid */}
                        <div className="flex-1 overflow-auto">
                            {loadingRows ? (
                                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                                    Loading…
                                </div>
                            ) : (
                                <table className="w-full text-xs border-collapse">
                                    <thead className="sticky top-0 z-10 bg-sidebar border-b border-border/50">
                                        <tr>
                                            {columns.map(col => (
                                                <th
                                                    key={col.name}
                                                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap border-r border-border/30 last:border-r-0"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>{col.name}</span>
                                                        {col.pk ? (
                                                            <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 rounded">
                                                                PK
                                                            </span>
                                                        ) : null}
                                                        <span className="text-[9px] text-muted-foreground/50 font-normal">
                                                            {col.type}
                                                        </span>
                                                    </div>
                                                </th>
                                            ))}
                                            <th className="px-3 py-2 w-10" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.length === 0 ? (
                                            <tr>
                                                <td
                                                    colSpan={columns.length + 1}
                                                    className="px-3 py-8 text-center text-muted-foreground"
                                                >
                                                    No rows
                                                </td>
                                            </tr>
                                        ) : (
                                            rows.map((row, i) => (
                                                <tr
                                                    key={i}
                                                    className="hover:bg-muted/30 cursor-pointer border-b border-border/30 group"
                                                    onClick={() =>
                                                        setEditRow(row)
                                                    }
                                                >
                                                    {columns.map(col => {
                                                        const val =
                                                            row[col.name];
                                                        const str =
                                                            val === null ||
                                                            val === undefined
                                                                ? ''
                                                                : String(val);
                                                        const isNull =
                                                            val === null ||
                                                            val === undefined;
                                                        return (
                                                            <td
                                                                key={col.name}
                                                                className="px-3 py-2 max-w-48 border-r border-border/20 last:border-r-0"
                                                            >
                                                                {isNull ? (
                                                                    <span className="text-muted-foreground/40 italic">
                                                                        null
                                                                    </span>
                                                                ) : (
                                                                    <span className="font-mono truncate block">
                                                                        {str.length >
                                                                        60
                                                                            ? str.slice(
                                                                                  0,
                                                                                  60
                                                                              ) +
                                                                              '…'
                                                                            : str}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-2 py-2 w-10">
                                                        <button
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setDeleteRow(
                                                                    row
                                                                );
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-5 py-2 border-t border-border/50 shrink-0 text-xs text-muted-foreground">
                                <span>
                                    Page {page + 1} of {totalPages} ({totalRows}{' '}
                                    rows)
                                </span>
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        disabled={page === 0}
                                        onClick={() => {
                                            const p = page - 1;
                                            setPage(p);
                                            loadRows(selectedTable, p);
                                        }}
                                    >
                                        Prev
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        disabled={page >= totalPages - 1}
                                        onClick={() => {
                                            const p = page + 1;
                                            setPage(p);
                                            loadRows(selectedTable, p);
                                        }}
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modals */}
            {editRow && selectedTable && (
                <RowModal
                    table={selectedTable}
                    columns={columns}
                    row={editRow === 'new' ? null : editRow}
                    onClose={() => setEditRow(null)}
                    onSave={() => {
                        setEditRow(null);
                        refresh();
                    }}
                />
            )}
            {deleteRow && selectedTable && (
                <DeleteConfirm
                    table={selectedTable}
                    row={deleteRow}
                    onClose={() => setDeleteRow(null)}
                    onDeleted={() => {
                        setDeleteRow(null);
                        refresh();
                    }}
                />
            )}
        </div>
        </AppLayout>
    );
}
