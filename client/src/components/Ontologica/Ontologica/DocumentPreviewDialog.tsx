import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, Loader2, Hash } from 'lucide-react';
import { useProjectContext } from './context';

interface DocumentFull {
  id: number;
  filename: string;
  content_text: string;
  mime_type: string;
  status: string;
  chunk_count: number;
  word_count: number;
  created_at: string;
}

export function DocumentPreviewDialog() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { projectId, docs } = useProjectContext();
  const [doc, setDoc] = useState<DocumentFull | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    fetch(`/app/api/ontologica/documents/${docId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setDoc(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [docId]);

  // Find similar documents by computing simple text overlap
  const similarities = useMemo(() => {
    if (!doc) return [];

    // Quick fingerprint: extract first 500 chars normalized
    const normalize = (text: string) =>
      text.toLowerCase().replace(/\s+/g, ' ').trim();

    const docFingerprint = normalize(doc.content_text).slice(0, 2000);

    // Compare with all other docs (we only have metadata here, not content)
    // We'll flag docs with the same word count as potential dupes
    return docs
      .filter(d => d.id !== doc.id)
      .map(d => ({
        ...d,
        sameWordCount: d.word_count === doc.word_count,
      }))
      .filter(d => d.sameWordCount);
  }, [doc, docs]);

  const handleClose = () => {
    navigate(`/ontologica/${projectId}/documents`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} className="text-emerald-500" />
            {doc?.filename || 'Loading...'}
          </DialogTitle>
          <DialogDescription>
            {doc ? (
              <span className="flex items-center gap-3">
                <Badge variant="secondary">{doc.status}</Badge>
                <span>{doc.word_count} words</span>
                <span>{doc.chunk_count > 0 ? `${doc.chunk_count} chunks` : 'not chunked'}</span>
                <span className="text-muted-foreground">
                  {new Date(doc.created_at).toLocaleString()}
                </span>
              </span>
            ) : 'Loading document...'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : !doc ? (
          <div className="flex-1 flex items-center justify-center py-12 text-muted-foreground">
            Document not found
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Potential duplicates warning */}
            {similarities.length > 0 && (
              <div className="px-1">
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-amber-400 font-medium mb-1">
                    <Hash size={14} />
                    Potential duplicates (same word count)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {similarities.map(s => (
                      <Badge
                        key={s.id}
                        variant="outline"
                        className="cursor-pointer border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                        onClick={() => navigate(`/ontologica/${projectId}/documents/preview/${s.id}`)}
                      >
                        {s.filename} ({s.word_count} words)
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* Document content */}
            <ScrollArea className="flex-1 min-h-0">
              <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed p-4 text-foreground/90">
                {doc.content_text}
              </pre>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
