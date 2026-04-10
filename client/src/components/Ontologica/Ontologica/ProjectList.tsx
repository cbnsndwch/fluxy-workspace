import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, FileText, GitBranch, Plus, Share2 } from 'lucide-react';
import type { OntologicaProject } from './OntologicaPage';

interface Props {
  projects: OntologicaProject[];
  onSelect: (id: number) => void;
  onNew: () => void;
}

export function ProjectList({ projects, onSelect, onNew }: Props) {
  if (projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <Brain size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first ontology project. Upload documents about your business domain
            and let AI extract a formal knowledge graph — concepts, relationships, and hierarchies.
          </p>
          <button
            onClick={onNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            <Plus size={18} /> Create First Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => (
          <Card
            key={p.id}
            className="cursor-pointer hover:border-emerald-500/50 transition-colors"
            onClick={() => onSelect(p.id)}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Brain size={20} className="text-emerald-500" />
                </div>
                <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                  {p.status}
                </Badge>
              </div>

              <h3 className="font-semibold text-lg mb-1">{p.name}</h3>
              {p.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
              )}
              {p.domain_hint && (
                <p className="text-xs text-muted-foreground mb-3">Domain: {p.domain_hint}</p>
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <FileText size={12} /> {p.doc_count ?? 0} docs
                </span>
                <span className="flex items-center gap-1">
                  <GitBranch size={12} /> {p.node_count} concepts
                </span>
                <span className="flex items-center gap-1">
                  <Share2 size={12} /> {p.edge_count} relations
                </span>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* New project card */}
        <Card
          className="cursor-pointer border-dashed hover:border-emerald-500/50 transition-colors"
          onClick={onNew}
        >
          <CardContent className="p-5 flex items-center justify-center h-full min-h-[160px]">
            <div className="text-center text-muted-foreground">
              <Plus size={24} className="mx-auto mb-2" />
              <span className="text-sm">New Project</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
