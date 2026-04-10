import { useState, useCallback, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText, Upload, Zap, Trash2, Eye, GripVertical, Plus } from 'lucide-react';

import { useProjectContext } from './context';

const ACCEPTED_TYPES = '.txt,.md,.csv,.json,.xml,.html,.tsv,.log,.yaml,.yml';

export function DocumentsTab() {
  const { projectId, docs: documents, loadDocs: onDocumentsChange, extractDocument: onExtract } = useProjectContext();
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error' }[]>([]);

  const uploadFile = async (name: string, text: string) => {
    const res = await fetch(`/app/api/ontologica/projects/${projectId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: name, content_text: text }),
    });
    return res.ok;
  };

  const handleUpload = async () => {
    if (!filename.trim() || !content.trim()) return;
    setUploading(true);
    const ok = await uploadFile(filename.trim(), content.trim());
    if (ok) {
      setFilename('');
      setContent('');
      setShowPaste(false);
      onDocumentsChange();
    }
    setUploading(false);
  };

  const handleDelete = async (docId: number) => {
    await fetch(`/app/api/ontologica/documents/${docId}`, { method: 'DELETE' });
    onDocumentsChange();
  };

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // Single file → open in paste editor for preview
    if (files.length === 1) {
      const text = await files[0].text();
      setFilename(files[0].name);
      setContent(text);
      setShowPaste(true);
      return;
    }

    // Multiple files → batch upload directly
    const queue = files.map(f => ({ name: f.name, status: 'pending' as const }));
    setUploadQueue(queue);

    for (let i = 0; i < files.length; i++) {
      setUploadQueue(q => q.map((item, j) => j === i ? { ...item, status: 'uploading' } : item));
      try {
        const text = await files[i].text();
        const ok = await uploadFile(files[i].name, text);
        setUploadQueue(q => q.map((item, j) => j === i ? { ...item, status: ok ? 'done' : 'error' } : item));
      } catch {
        setUploadQueue(q => q.map((item, j) => j === i ? { ...item, status: 'error' } : item));
      }
    }

    onDocumentsChange();
    setTimeout(() => setUploadQueue([]), 2000);
  }, [projectId, onDocumentsChange]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
    e.target.value = '';
  };

  // ── Drag-to-reorder state ───────────────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const saveOrder = async (ids: number[]) => {
    await fetch(`/app/api/ontologica/projects/${projectId}/documents/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    });
  };

  const handleReorderDrop = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...documents];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Optimistic update via reload after save
    saveOrder(reordered.map(d => d.id)).then(() => onDocumentsChange());
  }, [documents, projectId, onDocumentsChange]);

  const dragCounter = useRef(0);

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_TYPES.split(',').includes(ext);
    });

    if (files.length === 0) return;
    await processFiles(files);
  }, [processFiles]);

  const closeUpload = () => {
    setUploadOpen(false);
    setShowPaste(false);
    setFilename('');
    setContent('');
    setUploadQueue([]);
  };

  return (
    <div className="p-6 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Source Documents — drag to reorder, click extract to build knowledge
        </h3>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Plus size={14} className="mr-1" /> Add Documents
        </Button>
      </div>

      {documents.length === 0 && (
        <button
          onClick={() => setUploadOpen(true)}
          className="w-full text-center py-12 text-muted-foreground border-2 border-dashed border-muted rounded-lg cursor-pointer hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
        >
          <Upload size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">Click to add documents</p>
          <p className="text-xs mt-1">Upload files, drag & drop, or paste text</p>
        </button>
      )}

      <div className="space-y-2">
        {documents.map((doc, idx) => (
          <Card
            key={doc.id}
            className={`transition-all duration-150 ${
              dragIdx === idx ? 'opacity-40 scale-[0.98]' : ''
            } ${overIdx === idx && dragIdx !== idx ? 'border-emerald-500 shadow-lg shadow-emerald-500/10' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragIdx(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(idx));
            }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverIdx(idx); }}
            onDragLeave={() => setOverIdx(null)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const from = Number(e.dataTransfer.getData('text/plain'));
              setDragIdx(null); setOverIdx(null);
              handleReorderDrop(from, idx);
            }}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <GripVertical size={16} className="text-muted-foreground/50 cursor-grab active:cursor-grabbing shrink-0" />
                <FileText size={18} className="text-emerald-500 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.word_count} words • {doc.chunk_count > 0 ? `${doc.chunk_count} chunks` : 'not chunked'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={doc.status === 'processed' ? 'default' : 'secondary'}>
                  {doc.status}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/ontologica/${projectId}/documents/preview/${doc.id}`)} title="Preview document">
                  <Eye size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onExtract(doc.id)} title="Extract knowledge from this document">
                  <Zap size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(doc.id)} className="text-red-400 hover:text-red-300">
                  <Trash2 size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Upload modal */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!open) closeUpload(); else setUploadOpen(true); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Documents</DialogTitle>
          </DialogHeader>

          <div
            className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? 'border-emerald-500 bg-emerald-500/10' : 'border-muted hover:border-muted-foreground/30'
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={32} className={`mx-auto mb-2 ${dragOver ? 'text-emerald-500 animate-bounce' : 'text-muted-foreground/40'}`} />
            <p className="text-sm font-medium">{dragOver ? 'Drop files here' : 'Drag & drop files'}</p>
            <p className="text-xs text-muted-foreground mt-1">txt, md, csv, json, xml, html, yaml</p>
            <div className="flex items-center gap-3 mt-4 justify-center">
              <label className="cursor-pointer">
                <input type="file" className="hidden" accept={ACCEPTED_TYPES} multiple onChange={handleFileUpload} />
                <Button variant="outline" size="sm" asChild>
                  <span><Upload size={14} className="mr-1" /> Browse Files</span>
                </Button>
              </label>
              <Button variant="outline" size="sm" onClick={() => setShowPaste(!showPaste)}>
                <FileText size={14} className="mr-1" /> Paste Text
              </Button>
            </div>
          </div>

          {/* Upload queue progress */}
          {uploadQueue.length > 0 && (
            <div className="space-y-1 rounded-lg border border-emerald-500/30 p-3">
              {uploadQueue.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={
                    item.status === 'done' ? 'text-emerald-400' :
                    item.status === 'error' ? 'text-red-400' :
                    item.status === 'uploading' ? 'text-amber-400 animate-pulse' :
                    'text-muted-foreground'
                  }>
                    {item.status === 'done' ? '✓' : item.status === 'error' ? '✗' : item.status === 'uploading' ? '↑' : '•'}
                  </span>
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Paste text form */}
          {showPaste && (
            <div className="space-y-3">
              <Input
                placeholder="Document name (e.g., customer-support-sop.txt)"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                autoFocus
              />
              <Textarea
                placeholder="Paste your document text here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {content.split(/\s+/).filter(Boolean).length} words
                </span>
                <Button size="sm" onClick={handleUpload} disabled={uploading || !filename.trim() || !content.trim()}>
                  {uploading ? 'Uploading...' : 'Add Document'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-route dialog (document preview) */}
      <Outlet />
    </div>
  );
}
