/**
 * Ontologica Conversational AI
 *
 * The "describe your business" interface — transforms natural language
 * into ontology operations. Users talk, the knowledge graph grows.
 *
 * Architecture:
 *   User message + current ontology state → GPT-4o → structured actions
 *   → DB mutations → graph delta returned to frontend → real-time update
 */

import type Database from 'better-sqlite3';
import { llmChat, llmCall, extractJSON } from '../../llm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OntologyAction {
  type: 'add_class' | 'add_individual' | 'add_object_property' | 'add_data_property' | 'add_is_a' | 'remove_class' | 'update_class';
  name: string;
  description?: string;
  domain?: string;
  range?: string;
  datatype?: string;
  parent?: string;
  confidence?: number;
}

interface ChatResponse {
  message: string;
  actions: OntologyAction[];
  questions: string[];
  suggestions: string[];
}

interface AppliedAction extends OntologyAction {
  success: boolean;
  created_id?: number;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOntologySnapshot(db: Database.Database, projectId: number) {
  const classes = db.prepare(
    `SELECT id, name, description, parent_id, status FROM onto_nodes WHERE project_id = ? AND node_type = 'class' AND status != 'rejected' ORDER BY name`
  ).all(projectId) as any[];

  const individuals = db.prepare(
    `SELECT id, name, description, parent_id, status FROM onto_nodes WHERE project_id = ? AND node_type = 'individual' AND status != 'rejected' ORDER BY name`
  ).all(projectId) as any[];

  const edges = db.prepare(
    `SELECT e.id, e.edge_type, e.name, e.description, e.target_value,
            s.name as source_name, t.name as target_name
     FROM onto_edges e
     LEFT JOIN onto_nodes s ON e.source_node_id = s.id
     LEFT JOIN onto_nodes t ON e.target_node_id = t.id
     WHERE e.project_id = ? AND e.status != 'rejected'
     ORDER BY e.edge_type, e.name`
  ).all(projectId) as any[];

  // Build a readable snapshot
  const nodeMap = new Map(classes.map(c => [c.id, c]));
  const classLines = classes.map(c => {
    const parent = c.parent_id ? nodeMap.get(c.parent_id)?.name : null;
    return `  - ${c.name}${parent ? ` (subclass of ${parent})` : ''}${c.description ? `: ${c.description}` : ''}`;
  });

  const individualLines = individuals.map(i => {
    const parent = i.parent_id ? nodeMap.get(i.parent_id)?.name : null;
    return `  - ${i.name}${parent ? ` (type: ${parent})` : ''}${i.description ? `: ${i.description}` : ''}`;
  });

  const relLines = edges.map(e => {
    if (e.edge_type === 'is_a') return null; // already shown in class hierarchy
    if (e.edge_type === 'object_property') {
      return `  - ${e.source_name} --[${e.name}]--> ${e.target_name}`;
    }
    if (e.edge_type === 'data_property') {
      return `  - ${e.source_name} --[${e.name}]--> ${e.target_value || 'string'}`;
    }
    return null;
  }).filter(Boolean);

  return {
    classes,
    individuals,
    edges,
    summary: [
      classLines.length > 0 ? `Classes:\n${classLines.join('\n')}` : 'Classes: (none yet)',
      individualLines.length > 0 ? `Individuals:\n${individualLines.join('\n')}` : '',
      relLines.length > 0 ? `Relationships:\n${relLines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
  };
}

function getConversationHistory(db: Database.Database, projectId: number, limit = 20) {
  return db.prepare(
    `SELECT role, content FROM onto_conversations WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(projectId, limit).reverse() as { role: string; content: string }[];
}

// ── Core Chat Function ───────────────────────────────────────────────────────

export async function chat(
  db: Database.Database,
  projectId: number,
  userMessage: string
): Promise<{ response: ChatResponse; appliedActions: AppliedAction[] }> {
  const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('Project not found');

  const snapshot = getOntologySnapshot(db, projectId);
  const history = getConversationHistory(db, projectId);

  const systemPrompt = `You are an expert ontology engineer embedded in "Ontologica," an AI-powered knowledge mapping tool. Your job is to help a business owner model their domain through natural conversation.

## Your Role
- Listen to how they describe their business
- Extract meaningful domain concepts (classes), relationships (properties), and instances (individuals)
- Build a formal knowledge graph incrementally — each message adds to the existing model
- Ask smart clarifying questions to deepen the model
- Suggest what to model next based on gaps you see

## Current Project
Name: ${project.name}
Domain: ${project.domain_hint || 'not specified'}
Description: ${project.description || 'none'}

## Current Ontology State
${snapshot.summary || '(empty — nothing modeled yet)'}

## Rules
1. **Extract actionable entities.** When the user describes something, identify concrete classes, relationships, and attributes.
2. **Use clear naming.** Classes are PascalCase nouns (Customer, OrderItem). Properties are camelCase verbs (placesOrder, hasName).
3. **Build hierarchy.** If a concept is clearly a subtype, create the IS-A relationship (e.g., DigitalProduct IS-A Product).
4. **Don't over-extract.** Only create entities that are clearly implied by what the user said. Quality > quantity.
5. **Be conversational.** You're talking to a person, not filling out a form. Acknowledge what they said, explain what you're adding, ask follow-ups.
6. **Suggest strategically.** After each interaction, suggest 1-2 areas to explore next based on what's missing.
7. **Handle modifications.** If the user says "actually X should be Y" or "remove X", update accordingly.
8. **Never use ontology jargon** with the user. Say "concept" not "class", "connection" not "object property", "attribute" not "data property".

## Response Format
Respond with a JSON object:
{
  "message": "Your conversational response to the user. Be warm, clear, and show what you understood. Use markdown for formatting.",
  "actions": [
    // Each action represents a change to the knowledge graph
    { "type": "add_class", "name": "PascalCaseName", "description": "what this concept represents" },
    { "type": "add_class", "name": "SubType", "description": "...", "parent": "ParentClass" },
    { "type": "add_individual", "name": "SpecificThing", "description": "...", "parent": "ClassName" },
    { "type": "add_object_property", "name": "camelCaseName", "description": "...", "domain": "SourceClass", "range": "TargetClass" },
    { "type": "add_data_property", "name": "camelCaseName", "description": "...", "domain": "ClassName", "datatype": "string|integer|decimal|boolean|date|datetime|text" },
    { "type": "add_is_a", "name": "ChildClass", "parent": "ParentClass" }
  ],
  "questions": ["1-3 smart clarifying questions to deepen the model"],
  "suggestions": ["1-2 areas to explore next"]
}

If the user is just chatting or asking a question (not describing their domain), respond with an empty actions array.

IMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

  // Build messages array with history
  const chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];

  // Add conversation history (last N turns)
  for (const msg of history) {
    chatMessages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add current user message
  chatMessages.push({ role: 'user', content: userMessage });

  // Call LLM
  const rawText = await llmChat(systemPrompt, chatMessages, {
    model: 'smart',
    maxTokens: 4096,
    temperature: 0.4,
  });

  const raw = extractJSON(rawText);
  let response: ChatResponse;

  try {
    response = JSON.parse(raw);
    if (!response.message) response.message = 'I understood your input but had trouble formatting my response.';
    if (!response.actions) response.actions = [];
    if (!response.questions) response.questions = [];
    if (!response.suggestions) response.suggestions = [];
  } catch {
    response = {
      message: raw || 'Something went wrong processing your message.',
      actions: [],
      questions: [],
      suggestions: [],
    };
  }

  // Save conversation
  db.prepare(
    `INSERT INTO onto_conversations (project_id, role, content, actions) VALUES (?, 'user', ?, NULL)`
  ).run(projectId, userMessage);

  db.prepare(
    `INSERT INTO onto_conversations (project_id, role, content, actions) VALUES (?, 'assistant', ?, ?)`
  ).run(projectId, response.message, JSON.stringify(response.actions));

  // Apply actions
  const appliedActions = applyActions(db, projectId, response.actions);

  // Update project counts
  const nc = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(projectId) as any).c;
  const ec = (db.prepare('SELECT COUNT(*) as c FROM onto_edges WHERE project_id = ?').get(projectId) as any).c;
  db.prepare('UPDATE onto_projects SET node_count = ?, edge_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(nc, ec, projectId);

  return { response, appliedActions };
}

// ── Apply Actions to DB ──────────────────────────────────────────────────────

function applyActions(
  db: Database.Database,
  projectId: number,
  actions: OntologyAction[]
): AppliedAction[] {
  const findNode = db.prepare(
    'SELECT id FROM onto_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?)'
  );
  const insertNode = db.prepare(`
    INSERT INTO onto_nodes (project_id, node_type, name, description, uri, parent_id, confidence, status, pos_x, pos_y, metadata)
    VALUES (?, ?, ?, ?, NULL, ?, ?, 'approved', ?, ?, '{}')
  `);
  const insertEdge = db.prepare(`
    INSERT INTO onto_edges (project_id, edge_type, name, source_node_id, target_node_id, target_value, description, confidence, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', '{}')
  `);

  // Get current node count for auto-layout
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM onto_nodes WHERE project_id = ?').get(projectId) as any).c;
  let nodeIndex = existingCount;

  const results: AppliedAction[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_class':
        case 'add_individual': {
          const existing = findNode.get(projectId, action.name) as any;
          if (existing) {
            results.push({ ...action, success: true, created_id: existing.id, error: 'already exists' });
            break;
          }
          const nodeType = action.type === 'add_class' ? 'class' : 'individual';
          let parentId: number | null = null;
          if (action.parent) {
            const parentNode = findNode.get(projectId, action.parent) as any;
            parentId = parentNode?.id || null;
          }
          // Auto-layout: arrange in a grid
          const cols = 5;
          const posX = (nodeIndex % cols) * 280;
          const posY = Math.floor(nodeIndex / cols) * 200;
          nodeIndex++;

          const result = insertNode.run(
            projectId, nodeType, action.name, action.description || null,
            parentId, action.confidence ?? 0.9,
            posX, posY
          );
          const createdId = Number(result.lastInsertRowid);

          // If parent exists, also create IS-A edge
          if (parentId) {
            insertEdge.run(
              projectId, 'is_a', 'subClassOf', createdId, parentId,
              null, `${action.name} IS-A ${action.parent}`, 0.9
            );
          }

          results.push({ ...action, success: true, created_id: createdId });
          break;
        }

        case 'add_object_property': {
          const sourceNode = findNode.get(projectId, action.domain || '') as any;
          const targetNode = findNode.get(projectId, action.range || '') as any;
          if (!sourceNode || !targetNode) {
            results.push({ ...action, success: false, error: `Missing node: ${!sourceNode ? action.domain : action.range}` });
            break;
          }
          const result = insertEdge.run(
            projectId, 'object_property', action.name,
            sourceNode.id, targetNode.id, null,
            action.description || null, action.confidence ?? 0.9
          );
          results.push({ ...action, success: true, created_id: Number(result.lastInsertRowid) });
          break;
        }

        case 'add_data_property': {
          const domainNode = findNode.get(projectId, action.domain || '') as any;
          if (!domainNode) {
            results.push({ ...action, success: false, error: `Missing node: ${action.domain}` });
            break;
          }
          const result = insertEdge.run(
            projectId, 'data_property', action.name,
            domainNode.id, null, action.datatype || 'string',
            action.description || null, action.confidence ?? 0.9
          );
          results.push({ ...action, success: true, created_id: Number(result.lastInsertRowid) });
          break;
        }

        case 'add_is_a': {
          const childNode = findNode.get(projectId, action.name) as any;
          const parentNode = findNode.get(projectId, action.parent || '') as any;
          if (!childNode || !parentNode) {
            results.push({ ...action, success: false, error: `Missing node: ${!childNode ? action.name : action.parent}` });
            break;
          }
          // Set parent_id on child node
          db.prepare('UPDATE onto_nodes SET parent_id = ? WHERE id = ?').run(parentNode.id, childNode.id);
          const result = insertEdge.run(
            projectId, 'is_a', 'subClassOf', childNode.id, parentNode.id,
            null, `${action.name} IS-A ${action.parent}`, 0.9
          );
          results.push({ ...action, success: true, created_id: Number(result.lastInsertRowid) });
          break;
        }

        case 'remove_class': {
          const node = findNode.get(projectId, action.name) as any;
          if (node) {
            db.prepare('UPDATE onto_nodes SET status = ? WHERE id = ?').run('rejected', node.id);
            results.push({ ...action, success: true, created_id: node.id });
          } else {
            results.push({ ...action, success: false, error: 'Not found' });
          }
          break;
        }

        case 'update_class': {
          const node = findNode.get(projectId, action.name) as any;
          if (node) {
            if (action.description) {
              db.prepare('UPDATE onto_nodes SET description = ? WHERE id = ?').run(action.description, node.id);
            }
            results.push({ ...action, success: true, created_id: node.id });
          } else {
            results.push({ ...action, success: false, error: 'Not found' });
          }
          break;
        }

        default:
          results.push({ ...action, success: false, error: `Unknown action type: ${action.type}` });
      }
    } catch (err: any) {
      results.push({ ...action, success: false, error: err.message });
    }
  }

  return results;
}

// ── Natural Language Query ───────────────────────────────────────────────────

export async function queryOntology(
  db: Database.Database,
  projectId: number,
  question: string
): Promise<{ answer: string; relevant_entities: string[] }> {
  const project = db.prepare('SELECT * FROM onto_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('Project not found');

  const snapshot = getOntologySnapshot(db, projectId);

  // Also get instance data for richer answers
  const instances = db.prepare(
    `SELECT n.name, n.description, n.node_type, p.name as parent_name
     FROM onto_nodes n
     LEFT JOIN onto_nodes p ON n.parent_id = p.id
     WHERE n.project_id = ? AND n.status != 'rejected'
     ORDER BY n.node_type, n.name`
  ).all(projectId) as any[];

  const systemPrompt = `You are a knowledge graph query engine. Answer questions about the following ontology.

## Ontology: ${project.name}
Domain: ${project.domain_hint || 'general'}

## Schema
${snapshot.summary}

## All Entities
${instances.map(i => `- ${i.name} (${i.node_type}${i.parent_name ? `, type: ${i.parent_name}` : ''})${i.description ? `: ${i.description}` : ''}`).join('\n')}

## Rules
1. Answer based ONLY on what exists in the ontology. Don't fabricate information.
2. If the ontology doesn't contain enough information to answer, say so clearly.
3. Suggest what could be added to the model to answer the question better.
4. List the relevant entities involved in your answer.
5. Be concise and direct.`;

  const rawText = await llmCall(
    systemPrompt + '\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.',
    question,
    { model: 'fast', maxTokens: 2048, temperature: 0.2 }
  );

  const raw = extractJSON(rawText);

  try {
    const parsed = JSON.parse(raw);
    return {
      answer: parsed.answer || parsed.message || raw,
      relevant_entities: parsed.relevant_entities || parsed.entities || [],
    };
  } catch {
    return { answer: raw, relevant_entities: [] };
  }
}
