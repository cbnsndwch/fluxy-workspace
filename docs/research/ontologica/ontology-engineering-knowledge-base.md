# Ontology Engineering Knowledge Base

## 1. Academic Foundations

### LLMs4OL Benchmark (2024-2025)
4 canonical subtasks:
- **Task A — Term Typing**: Given term → discover type (e.g., "aspirin" → "Drug"). MAP@K evaluation.
- **Task B — Taxonomy Discovery**: Given pair of types → determine is-a relationship and direction. F1 evaluation.
- **Task C — NTRE**: Given two types → identify non-hierarchical relations (treats, part-of). F1 evaluation.
- **Task D — Text2Onto (2025)**: End-to-end extraction from raw text. Most ambitious.
Key findings: hybrid pipelines (commercial LLMs + domain-tuned embeddings) win. GPT-4 dominates zero-shot but fine-tuned Flan-T5-XL is competitive.

### Ontogenia — 5-Stage Metacognitive Prompting (ESWC 2025)
Follows eXtreme Design (XD) methodology:
1. Understanding — comprehend input CQs and domain
2. Preliminary Judgment — initial ontological model
3. Critical Evaluation — self-critique for gaps, redundancies
4. Final Decision — revised ontology with reasoning
5. Confidence Assessment — flag uncertain elements
Key: o1-preview + Ontogenia achieved 0.96-1.0 adequate CQ modeling, outperforming novice human modelers.
Implementation: cumulative OWL output, each thematic group carries forward as context.

### OntoGen Pipeline (RSC 2026)
5-stage zero-shot pipeline using open-source LLMs:
1. Vocabulary Extraction (with anti-hallucination text verification)
2. Category Extraction (self-consistency voting across multiple runs)
3. Taxonomy Construction (iterative, top-down, loop detection for DAG)
4. KG Instantiation (leaves → instances, non-leaves → classes)
5. Relationship Extraction (vocabulary-grounded triples)
Results: 92.8% term accuracy, 0.737 hierarchical F1.

### OntoGPT/SPIRES
Schema-driven extraction using LinkML templates:
- LinkML schema defines target structure
- LLM fills pseudo-YAML prompts
- Recursive extraction for nested structures
- Multi-stage ontology grounding (CURIE matching → morphological → dictionary → OAK annotator)
Supports OpenAI, Anthropic, Mistral, Ollama, LiteLLM.

### OG-RAG (EMNLP 2025)
Ontology-grounded RAG using hypergraph retrieval:
1. Ontology-to-document mapping → factual blocks via JSON-LD
2. Hypergraph construction (hyperedges = complex fact clusters)
3. Greedy set-cover retrieval optimization
Results: +55% recall, +40% correctness, +30% faster attribution vs standard RAG.
Key: requires pre-existing ontology (chicken-and-egg problem our tool solves).

## 2. Practical Formats

### OWL2
Key constructs: owl:Class, rdfs:subClassOf, owl:ObjectProperty, owl:DatatypeProperty, owl:FunctionalProperty, owl:inverseOf, owl:Restriction, owl:equivalentClass, owl:AllDisjointClasses
Profiles: EL (polynomial reasoning, SNOMED-CT scale), QL (SQL-rewritable), RL (rule engines)

### RDF Layer Cake
RDF (raw triples: subject-predicate-object) → RDFS (classes, hierarchy) → OWL (logic, axioms, reasoning)

### JSON-LD
JSON that is valid RDF. @context maps keys to URIs. Can be expanded/compacted/flattened. Convert to N-Quads with jsonld.js.
Key advantage: web developers can parse it, triplestores can query it.

### SPARQL
SQL for RDF. SELECT, CONSTRUCT, INSERT, DELETE. GROUP BY, HAVING, FILTER, OPTIONAL.
JS tools: Comunica (in-memory SPARQL), N3.js (parsing/serializing).

### SKOS vs OWL
SKOS = vocabularies/taxonomies (broader/narrower/related, no inference). OWL = formal domain models with reasoning.

## 3. Toolchain (OWLReady2)
Python library. Treats ontologies as native Python objects. SQLite-based quadstore (tested 1B+ triples). Bundled reasoners: HermiT, Pellet. Full SPARQL support. Can create classes, properties, restrictions, individuals programmatically and run reasoning.

## 4. Market Gap Analysis

### Current landscape
- Palantir: $1M+/year, enterprise only, proprietary
- Neo4j: infrastructure, no ontology UX
- Protégé: free but hostile to non-experts, 2005-era Java UX
- TopBraid: $100K-$500K/year, enterprise governance
- PoolParty: taxonomy-focused, enterprise
- Stardog: enterprise graph DB, $50K+/year

### The uncontested space
AI-first ontology tool for SMBs. Conversational entry → instant visualization → data connection → immediate value.
No existing player serves this. The "Canva of ontologies."

### What SMBs need
1. Describe business in plain language → get structured model
2. Connect real data (spreadsheets, APIs)
3. Immediate utility: queries, insights, automations
4. Templates for common domains
5. Evolving models (grow organically)
6. Pricing: $29-$299/month

## 5. Combined Architecture (Our Approach)
1. LLMs4OL task decomposition → evaluate each ontology subtask
2. OntoGen pipeline → extract vocabulary, categories, taxonomy from text
3. Ontogenia metacognitive refinement → quality assurance
4. JSON-LD materialization → formal ontology with validation
5. OntoGPT/SPIRES patterns → populate instances from new documents
6. OG-RAG → production retrieval layer

## 6. Critical Gap
Automated axiom generation and validation remains unsolved. OWL axioms (disjointness, cardinality, property chains) are where human oversight is still essential → our "minimal human supervision" approach.
