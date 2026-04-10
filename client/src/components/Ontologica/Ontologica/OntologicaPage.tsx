import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { AppLayout } from '@/components/ui/app-layout';
import { Button } from '@/components/ui/button';
import { Brain, Plus } from 'lucide-react';
import { ProjectList } from './ProjectList';
import { NewProjectDialog } from './NewProjectDialog';

export interface OntologicaProject {
  id: number;
  name: string;
  description: string | null;
  domain_hint: string | null;
  base_uri: string;
  status: string;
  node_count: number;
  edge_count: number;
  doc_count?: number;
  created_at: string;
  updated_at: string;
}

export default function OntologicaPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<OntologicaProject[]>([]);
  const [showNew, setShowNew] = useState(false);

  const loadProjects = useCallback(async () => {
    const res = await fetch('/app/api/ontologica/projects');
    if (res.ok) setProjects(await res.json());
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleCreate = async (data: { name: string; description: string; domain_hint: string }) => {
    const res = await fetch('/app/api/ontologica/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const project = await res.json();
      setShowNew(false);
      loadProjects();
      navigate(`/ontologica/${project.id}/chat`);
    }
  };

  return (
    <AppLayout
      icon={<Brain size={20} />}
      iconClassName="bg-emerald-500/10 text-emerald-500"
      title="Ontologica"
      subtitle="AI-powered ontology mapping — upload documents, extract knowledge graphs"
      actions={
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus size={16} className="mr-1" /> New Project
        </Button>
      }
    >
      <ProjectList
        projects={projects}
        onSelect={(id) => navigate(`/ontologica/${id}/chat`)}
        onNew={() => setShowNew(true)}
      />
      <NewProjectDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreate={handleCreate}
      />
    </AppLayout>
  );
}
