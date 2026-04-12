/**
 * Unified Pipeline Type System
 *
 * All ontology lifecycle operations (extract, deduplicate, map, review)
 * share a common pipeline/proposals model. Each type has its own stages
 * and proposal types, but the infrastructure is identical.
 */

export type PipelineType = 'extract' | 'deduplicate' | 'map' | 'review';
export type PipelineMode = 'automated' | 'supervised' | 'external';
export type ProposalStatus =
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'applied'
    | 'skipped';

export interface PipelineTypeDef {
    type: PipelineType;
    label: string;
    color: string;
    stages: string[];
    proposalTypes: string[];
    description: string;
}

export const PIPELINE_TYPES: Record<PipelineType, PipelineTypeDef> = {
    extract: {
        type: 'extract',
        label: 'Extract',
        color: 'blue',
        stages: [
            'chunk',
            'terms',
            'classify',
            'base_resolve',
            'taxonomy',
            'relations',
            'validate',
            'merge',
            'done'
        ],
        proposalTypes: ['create_node', 'create_edge'],
        description: 'Extract ontology from documents using AI'
    },
    deduplicate: {
        type: 'deduplicate',
        label: 'Deduplicate',
        color: 'amber',
        stages: ['embed', 'compare', 'propose', 'done'],
        proposalTypes: ['merge', 'not_duplicate'],
        description: 'Find and merge duplicate concepts'
    },
    map: {
        type: 'map',
        label: 'Map',
        color: 'violet',
        stages: ['scan', 'embed', 'evaluate', 'propose', 'done'],
        proposalTypes: ['link_to_base', 'subclass_of', 'no_match'],
        description: 'Map custom concepts to base layer vocabularies'
    },
    review: {
        type: 'review',
        label: 'Review',
        color: 'green',
        stages: ['generate', 'await_response', 'parse', 'apply', 'done'],
        proposalTypes: ['approve', 'reject', 'edit', 'reclassify'],
        description: 'Human-in-the-loop review and approval'
    }
};

/** Get stage index for progress calculation */
export function stageProgress(type: PipelineType, stage: string): number {
    const stages = PIPELINE_TYPES[type].stages;
    const idx = stages.indexOf(stage);
    if (idx === -1) return 0;
    // done = 100%, last real stage = ~90%, etc.
    return Math.round((idx / (stages.length - 1)) * 100);
}
