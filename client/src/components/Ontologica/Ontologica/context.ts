import { useOutletContext } from 'react-router';
import type { OntologicaProject } from './OntologicaPage';

export interface OntologicaContext {
  projectId: number;
  project: OntologicaProject | null;
  nodes: any[];
  edges: any[];
  docs: any[];
  jobs: any[];
  stats: any;
  extracting: boolean;
  // Data loaders
  loadProject: () => Promise<void>;
  loadGraph: () => Promise<void>;
  loadDocs: () => Promise<void>;
  loadJobs: () => Promise<void>;
  loadStats: () => Promise<void>;
  // Actions
  navigateToTab: (tab: string) => void;
  extractAll: () => Promise<void>;
  extractDocument: (docId: number) => Promise<void>;
}

export function useProjectContext() {
  return useOutletContext<OntologicaContext>();
}
