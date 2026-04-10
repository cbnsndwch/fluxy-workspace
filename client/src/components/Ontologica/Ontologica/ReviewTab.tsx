import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Box, CircleDot, Share2, Check, X, CheckCheck } from 'lucide-react';

import { useProjectContext } from './context';

export function ReviewTab() {
  const { projectId, nodes, edges, loadGraph, loadStats, loadProject } = useProjectContext();
  const onReviewComplete = () => { loadGraph(); loadStats(); loadProject(); };
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());

  const pendingNodes = nodes.filter(n => n.status === 'suggested');
  const pendingEdges = edges.filter(e => e.status === 'suggested');
  const totalPending = pendingNodes.length + pendingEdges.length;

  const toggleNode = (id: number) => {
    const next = new Set(selectedNodes);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedNodes(next);
  };

  const toggleEdge = (id: number) => {
    const next = new Set(selectedEdges);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedEdges(next);
  };

  const selectAll = () => {
    setSelectedNodes(new Set(pendingNodes.map(n => n.id)));
    setSelectedEdges(new Set(pendingEdges.map(e => e.id)));
  };

  const handleReview = async (action: 'approved' | 'rejected') => {
    await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_ids: Array.from(selectedNodes),
        edge_ids: Array.from(selectedEdges),
        action,
      }),
    });
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    onReviewComplete();
  };

  const handleApproveAll = async () => {
    await fetch(`/app/api/ontologica/projects/${projectId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_ids: pendingNodes.map(n => n.id),
        edge_ids: pendingEdges.map(e => e.id),
        action: 'approved',
      }),
    });
    onReviewComplete();
  };

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const selectedCount = selectedNodes.size + selectedEdges.size;

  if (totalPending === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
        <div className="text-center">
          <CheckCheck size={40} className="mx-auto mb-3 text-emerald-500 opacity-50" />
          <p className="text-lg font-medium mb-1">All caught up</p>
          <p className="text-sm">No items pending review. Run extraction to generate new suggestions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{totalPending} items pending review</h3>
          <p className="text-xs text-muted-foreground">
            AI-extracted concepts and relationships need your approval before they become part of the ontology
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleApproveAll}
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <Check size={14} className="mr-1" /> Approve All
          </Button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
          <span className="text-sm">{selectedCount} selected</span>
          <Button size="sm" variant="outline" className="text-emerald-400" onClick={() => handleReview('approved')}>
            <Check size={14} className="mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="text-red-400" onClick={() => handleReview('rejected')}>
            <X size={14} className="mr-1" /> Reject
          </Button>
        </div>
      )}

      {/* Pending nodes */}
      {pendingNodes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Concepts ({pendingNodes.length})</h4>
          <div className="space-y-1.5">
            {pendingNodes.map(n => (
              <Card key={n.id} className={`transition-colors ${selectedNodes.has(n.id) ? 'border-emerald-500/50' : ''}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedNodes.has(n.id)}
                    onChange={() => toggleNode(n.id)}
                    className="h-4 w-4 rounded border-muted accent-emerald-500"
                  />
                  {n.node_type === 'class'
                    ? <Box size={14} className="text-emerald-400 shrink-0" />
                    : <CircleDot size={14} className="text-violet-400 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{n.name}</span>
                    {n.description && (
                      <p className="text-xs text-muted-foreground truncate">{n.description}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{n.node_type}</Badge>
                  <span className="text-xs text-muted-foreground">{Math.round(n.confidence * 100)}%</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Pending edges */}
      {pendingEdges.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Relationships ({pendingEdges.length})</h4>
          <div className="space-y-1.5">
            {pendingEdges.map(e => {
              const src = nodeMap.get(e.source_node_id);
              const tgt = nodeMap.get(e.target_node_id);
              return (
                <Card key={e.id} className={`transition-colors ${selectedEdges.has(e.id) ? 'border-emerald-500/50' : ''}`}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedEdges.has(e.id)}
                      onChange={() => toggleEdge(e.id)}
                      className="h-4 w-4 rounded border-muted accent-emerald-500"
                    />
                    <Share2 size={14} className="text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm">
                        <span className="font-medium">{src?.name || '?'}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className="text-emerald-400">{e.name || e.edge_type}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className="font-medium">{tgt?.name || e.target_value || '?'}</span>
                      </span>
                      {e.description && (
                        <p className="text-xs text-muted-foreground truncate">{e.description}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px]">{e.edge_type}</Badge>
                    <span className="text-xs text-muted-foreground">{Math.round(e.confidence * 100)}%</span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
