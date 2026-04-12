# Onto — AI-First Ontology Studio

## Vision
"It's gonna be ok, I gotchu" — an ontology mapping system that combines minimal human supervision with heavy AI delegation. Designed for real businesses that have no idea how AI is the future.

## Core UX Loop
1. **Describe** → User talks to the AI in plain language: "We have customers who place orders. Orders contain products from suppliers."
2. **Visualize** → A live knowledge graph materializes in real-time as the AI processes
3. **Refine** → User adjusts via conversation ("Actually, a customer can be a person or a company") or direct graph manipulation
4. **Populate** → Upload CSV/JSON, paste text, or connect APIs → instances flow into the ontology
5. **Query** → Ask questions in natural language: "Which supplier has the most late deliveries?"
6. **Export** → OWL, JSON-LD, Turtle, or use via API

## Architecture

### Data Model (SQLite)

```sql
-- Ontology projects
CREATE TABLE onto_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  base_uri TEXT DEFAULT 'http://example.org/ontology#',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
  metadata TEXT, -- JSON for extra config
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Classes (concepts/entity types)
CREATE TABLE onto_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  parent_id INTEGER REFERENCES onto_classes(id) ON DELETE SET NULL,
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  color TEXT DEFAULT '#8b5cf6',
  icon TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, uri)
);

-- Properties (object properties = relations, datatype properties = attributes)
CREATE TABLE onto_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  property_type TEXT NOT NULL CHECK(property_type IN ('object', 'datatype')),
  domain_class_id INTEGER REFERENCES onto_classes(id) ON DELETE CASCADE,
  range_class_id INTEGER REFERENCES onto_classes(id) ON DELETE SET NULL,
  range_datatype TEXT CHECK(range_datatype IN ('string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'uri', 'text')),
  is_functional BOOLEAN DEFAULT 0,
  is_inverse_functional BOOLEAN DEFAULT 0,
  inverse_property_id INTEGER REFERENCES onto_properties(id) ON DELETE SET NULL,
  min_cardinality INTEGER,
  max_cardinality INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, uri)
);

-- Instances (individuals/entities)
CREATE TABLE onto_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  label TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES onto_classes(id) ON DELETE CASCADE,
  metadata TEXT, -- JSON for extra data
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, uri)
);

-- Triple store for instance data
CREATE TABLE onto_triples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  subject_instance_id INTEGER NOT NULL REFERENCES onto_instances(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES onto_properties(id) ON DELETE CASCADE,
  object_instance_id INTEGER REFERENCES onto_instances(id) ON DELETE SET NULL,
  object_literal TEXT,
  object_datatype TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- AI conversation per project
CREATE TABLE onto_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  actions TEXT, -- JSON: what the AI did (added classes, properties, etc.)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Import jobs
CREATE TABLE onto_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('csv', 'json', 'text', 'url', 'document')),
  source_name TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  mapping TEXT, -- JSON: column → property mappings
  result TEXT, -- JSON: summary of what was imported
  created_at TEXT DEFAULT (datetime('now'))
);

-- Competency questions (what the ontology should answer)
CREATE TABLE onto_competency_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES onto_projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  sparql_equivalent TEXT, -- auto-generated SPARQL
  status TEXT DEFAULT 'unanswered' CHECK(status IN ('unanswered', 'answerable', 'needs_refinement')),
  answer TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Backend Architecture

```
backend/apps/onto/
├── index.ts          -- Express router, all routes
├── ai.ts             -- LLM integration (extraction, refinement, querying)
├── export.ts         -- OWL/Turtle/JSON-LD serialization
├── import.ts         -- CSV/JSON/text import with auto-mapping
└── sparql.ts         -- SPARQL query engine over the triple store
```

### API Routes

```
Projects:
  GET    /api/onto/projects              -- list all projects
  POST   /api/onto/projects              -- create project
  GET    /api/onto/projects/:id          -- get project with stats
  PATCH  /api/onto/projects/:id          -- update project
  DELETE /api/onto/projects/:id          -- delete project

Schema (Classes & Properties):
  GET    /api/onto/projects/:id/classes          -- list classes
  POST   /api/onto/projects/:id/classes          -- create class
  PATCH  /api/onto/projects/:id/classes/:cid     -- update class
  DELETE /api/onto/projects/:id/classes/:cid     -- delete class
  GET    /api/onto/projects/:id/properties       -- list properties
  POST   /api/onto/projects/:id/properties       -- create property
  PATCH  /api/onto/projects/:id/properties/:pid  -- update property
  DELETE /api/onto/projects/:id/properties/:pid  -- delete property

Instances & Triples:
  GET    /api/onto/projects/:id/instances        -- list instances (with pagination)
  POST   /api/onto/projects/:id/instances        -- create instance
  PATCH  /api/onto/projects/:id/instances/:iid   -- update instance
  DELETE /api/onto/projects/:id/instances/:iid   -- delete instance
  GET    /api/onto/projects/:id/triples          -- query triples
  POST   /api/onto/projects/:id/triples          -- add triple

AI:
  POST   /api/onto/projects/:id/ai/chat          -- conversational ontology building
  POST   /api/onto/projects/:id/ai/extract       -- extract ontology from text
  POST   /api/onto/projects/:id/ai/query         -- natural language query
  POST   /api/onto/projects/:id/ai/refine        -- metacognitive refinement pass
  POST   /api/onto/projects/:id/ai/suggest-cqs   -- generate competency questions

Import/Export:
  POST   /api/onto/projects/:id/import/csv       -- import CSV with auto-mapping
  POST   /api/onto/projects/:id/import/text      -- extract from raw text
  GET    /api/onto/projects/:id/export/jsonld     -- export as JSON-LD
  GET    /api/onto/projects/:id/export/turtle     -- export as Turtle
  GET    /api/onto/projects/:id/export/owl        -- export as OWL/XML

Competency Questions:
  GET    /api/onto/projects/:id/cqs              -- list CQs
  POST   /api/onto/projects/:id/cqs              -- add CQ
  POST   /api/onto/projects/:id/cqs/:qid/test    -- test if CQ is answerable
```

### Frontend Architecture

```
client/src/components/Onto/
├── OntoPage.tsx              -- main page with AppLayout
├── ProjectList.tsx           -- project gallery/list
├── OntologyEditor.tsx        -- the core editor (split panel)
├── GraphView.tsx             -- React Flow graph of classes & properties
├── ClassNode.tsx             -- custom node for ontology classes
├── PropertyEdge.tsx          -- custom edge for properties
├── ConversationPanel.tsx     -- AI chat panel (left side)
├── DataPanel.tsx             -- instances/triples data view (bottom)
├── ImportDialog.tsx          -- CSV/text import wizard
├── ExportDialog.tsx          -- export format picker
├── CompetencyQuestions.tsx   -- CQ management panel
└── QueryPanel.tsx            -- natural language query interface
```

### AI Pipeline Architecture

```
User Input (natural language)
       │
       ▼
┌─────────────────────────────────────┐
│  1. EXTRACTION LAYER                │
│  - Parse domain description         │
│  - Identify entities (nouns)        │
│  - Identify relationships (verbs)   │
│  - Identify attributes              │
│  - Identify constraints             │
│  - Anti-hallucination: verify all   │
│    extracted terms exist in input    │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  2. ONTOGENIA REFINEMENT            │
│  Stage 1: Understanding             │
│  Stage 2: Preliminary judgment      │
│  Stage 3: Critical self-evaluation  │
│  Stage 4: Revised model             │
│  Stage 5: Confidence assessment     │
│  - Flag uncertain elements          │
│  - Suggest clarifying questions     │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  3. MATERIALIZATION                 │
│  - Create/update DB records         │
│  - Position nodes in graph          │
│  - Generate JSON-LD representation  │
│  - Validate logical consistency     │
│  - Return change delta to frontend  │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  4. RESPONSE GENERATION             │
│  - Summarize what was done          │
│  - Ask clarifying questions         │
│  - Suggest next steps               │
│  - Show confidence per element      │
└─────────────────────────────────────┘
```

### Build Phases

**Phase 1 — Foundation** (core data model + visual editor)
- SQLite tables
- Backend CRUD routes
- React Flow graph visualization
- Manual class/property creation via UI
- Project list page

**Phase 2 — AI Extraction** (the magic)
- Conversational ontology builder
- LLM extracts entities/relationships from natural language
- Real-time graph updates
- Clarifying question generation
- Competency questions

**Phase 3 — Data Import** (populate the ontology)
- CSV upload with AI-powered column mapping
- Text document extraction
- Instance creation from imported data
- Data validation against schema

**Phase 4 — Querying & Insights** (deliver value)
- Natural language → SPARQL translation
- Query results visualization
- Dashboard with ontology stats
- Anomaly detection

**Phase 5 — Export & API** (interop)
- JSON-LD, Turtle, OWL/XML export
- REST API for external consumption
- Webhook integration

**Phase 6 — OG-RAG** (production retrieval)
- Document ingestion pipeline
- Ontology-grounded retrieval
- Chat interface for knowledge queries
- Hypergraph construction

## Design Principles

1. **Conversation-first**: The AI chat IS the primary interface. The graph is the visualization, not the input method.
2. **Instant gratification**: Every user message should produce a visible change in the graph within seconds.
3. **Progressive disclosure**: Start simple (3 classes, 2 relationships), add complexity as needed.
4. **No jargon**: Never say "ontology" in the UI. Use "knowledge map", "business model", "schema."
5. **Forgiveness**: Undo everything. Version every change. Never lose work.
6. **Templates**: Offer pre-built domain templates (e-commerce, CRM, healthcare) as starting points.

## Technical Stack

- **Database**: SQLite (workspace standard)
- **Backend**: Express.js (workspace standard)
- **Frontend**: React + React Flow + TailwindCSS
- **LLM**: OpenAI API (gpt-4o for extraction, gpt-4o-mini for queries)
- **Serialization**: Custom JSON-LD/Turtle/OWL generators (no heavy Java deps)
- **Graph Layout**: dagre (automatic layout) + manual positioning
