/**
 * Selectors.
 *
 * Pure functions that turn store state into view models. Components ask
 * selectors rather than reaching into state shape, so the reducer can change
 * without touching the UI.
 */

import { buildGraph, computeGraphStats, getNodesByType } from '../legal/graphEngine.js';
import { assessAllObligations, buildTimeline, summarizeObligations } from '../legal/obligationEngine.js';
import { ENTITY_TYPES, modelCounts } from '../legal/schema.js';
import { summarizeEvidenceCoverage } from '../documents/evidence.js';
import {
  augmentGraphWithFindings,
  buildFocusedGraphViewModel,
  buildGraphViewModel,
  suggestGraphTopics,
  summarizeGraphViewModel,
} from '../legal/graphView.js';
import { buildObligationBoard, buildRightsBoard } from '../legal/obligationViews.js';
import { buildTimelineView } from '../legal/timelineView.js';
import { collectRiskSignals } from '../legal/riskRules.js';
import { collectInconsistencies } from '../legal/inconsistencyRules.js';


export function selectActiveEntry(state) {
  const id = state?.activeDocumentId;
  return id ? state.documents?.[id] ?? null : null;
}

export function selectEntry(state, documentId) {
  return documentId ? state?.documents?.[documentId] ?? null : null;
}

export function selectDocumentSummaries(state) {
  return (state?.order ?? []).map((id) => {
    const entry = state.documents[id];
    const model = entry?.model ?? null;
    return {
      id,
      title: model?.documents?.[0]?.title ?? entry?.content?.fileName ?? 'Untitled document',
      documentType: model?.documents?.[0]?.documentType ?? 'unknown',
      effectiveDate: model?.documents?.[0]?.effectiveDate ?? null,
      pageCount: entry?.content?.pageCount ?? model?.documents?.[0]?.pageCount ?? null,
      charCount: entry?.content?.charCount ?? 0,
      source: entry?.source ?? 'unknown',
      extracting: Boolean(entry?.extracting),
      error: entry?.error ?? null,
      counts: model ? modelCounts(model) : null,
      coverage: model ? summarizeEvidenceCoverage(model) : null,
      warnings: entry?.warnings ?? [],
      report: entry?.extractionReport ?? null,
      stages: entry?.stages ?? [],
      stageSummary: entry?.stageSummary ?? null,
    };
  });
}

export function selectModel(state, documentId = null) {
  return selectEntry(state, documentId ?? state?.activeDocumentId)?.model ?? null;
}

export function selectContent(state, documentId = null) {
  return selectEntry(state, documentId ?? state?.activeDocumentId)?.content ?? null;
}

export function selectGraph(state, documentId = null) {
  return selectEntry(state, documentId ?? state?.activeDocumentId)?.graph ?? null;
}

/** Builds a graph on demand when the store has a model but no cached graph. */
export function selectGraphOrBuild(state, documentId = null) {
  const entry = selectEntry(state, documentId ?? state?.activeDocumentId);
  if (!entry) return null;
  if (entry.graph) return entry.graph;
  return entry.model ? buildGraph(entry.model, { documentId: entry.id }) : null;
}

export function selectDocuments(state) {
  return (state?.order ?? []).map((id) => state.documents[id]).filter(Boolean);
}

function indexFor(model) {
  const map = new Map();
  for (const clause of model?.clauses ?? []) map.set(clause.id, clause);
  for (const party of model?.parties ?? []) map.set(party.id, party);
  for (const entity of model?.deadlines ?? []) map.set(entity.id, entity);
  for (const entity of model?.conditions ?? []) map.set(entity.id, entity);
  for (const entity of model?.consequences ?? []) map.set(entity.id, entity);
  return map;
}

export function selectAllObligationRows(state, documentId = null) {
  const model = selectModel(state, documentId);
  if (!model) return [];
  const { context, assessments } = assessAllObligations(model);
  const resolve = (id) => (id ? context.index.get(id)?.entity ?? null : null);
  return (model.obligations ?? []).map((obligation) => ({
    obligation,
    assessment: assessments.get(obligation.id),
    obligor: resolve(obligation.obligorPartyId),
    obligee: resolve(obligation.obligeePartyId),
    clause: resolve(obligation.clauseId),
    deadline: resolve(obligation.deadlineId),
    triggerCondition: resolve(obligation.triggerConditionId),
    consequences: (obligation.consequenceIds ?? []).map(resolve).filter(Boolean),
  }));
}

export function selectTimeline(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  return model ? buildTimeline(model, options) : null;
}

export function selectObligationSummary(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  return model ? summarizeObligations(model, options) : null;
}

export function selectRiskRows(state, documentId = null) {
  const model = selectModel(state, documentId);
  if (!model) return [];
  const index = indexFor(model);
  return (model.risks ?? []).map((risk) => ({
    risk,
    clause: risk.clauseId ? index.get(risk.clauseId) ?? null : null,
  }));
}

export function selectInconsistencyRows(state, documentId = null) {
  const model = selectModel(state, documentId);
  if (!model) return [];
  const index = indexFor(model);
  return (model.inconsistencies ?? []).map((inconsistency) => ({
    inconsistency,
    clauses: (inconsistency.clauseIds ?? []).map((id) => index.get(id)).filter(Boolean),
  }));
}

/**
 * Single view model for the workspace dashboard and status area: everything the
 * UI needs in order to be honest about coverage, gaps and AI boundaries.
 */
export function selectWorkspaceSummary(state, options = {}) {
  const entry = selectActiveEntry(state);
  if (!entry?.model) {
    return {
      entry,
      ready: false,
      model: null,
      counts: null,
      coverage: null,
      obligations: null,
      timeline: null,
      graph: null,
      graphStats: null,
      risks: [],
      inconsistencies: [],
      gaps: [],
      report: entry?.extractionReport ?? null,
    };
  }

  const model = entry.model;
  const graph = entry.graph ?? buildGraph(model, { documentId: entry.id });
  const coverage = summarizeEvidenceCoverage(model);
  const obligations = summarizeObligations(model, options);
  const timeline = buildTimeline(model, options);
  const report = entry.extractionReport ?? null;

  const gaps = [];
  if (obligations.withoutDeadline.length > 0) {
    gaps.push({
      code: 'gap.no-deadline',
      severity: 'warning',
      message: `${obligations.withoutDeadline.length} obligation(s) have no deadline on record.`,
    });
  }
  if (obligations.unknownTiming.length > 0) {
    gaps.push({
      code: 'gap.unknown-timing',
      severity: 'warning',
      message: `${obligations.unknownTiming.length} obligation(s) have a deadline that could not be resolved to a calendar date.`,
    });
  }
  if (timeline.undated.length > 0) {
    gaps.push({
      code: 'gap.undated-deadlines',
      severity: 'info',
      message: `${timeline.undated.length} deadline(s) could not be placed on the calendar.`,
    });
  }
  if (coverage.unverified > 0) {
    gaps.push({
      code: 'gap.unverified-facts',
      severity: 'warning',
      message: `${coverage.unverified} extracted fact(s) lack a verified citation.`,
    });
  }
  if (report?.evidence?.rejectedEntities > 0) {
    gaps.push({
      code: 'gap.rejected-facts',
      severity: 'warning',
      message: `${report.evidence.rejectedEntities} proposed fact(s) were rejected because their citations could not be verified.`,
    });
  }
  if ((report?.injectionWarnings ?? []).length > 0) {
    gaps.push({
      code: 'gap.prompt-injection',
      severity: 'info',
      message: `${report.injectionWarnings.length} instruction-like passage(s) were neutralised before analysis.`,
    });
  }

  return {
    entry,
    ready: true,
    model,
    counts: modelCounts(model),
    coverage,
    obligations,
    timeline,
    graph,
    graphStats: graph?.stats ?? computeGraphStats(graph),
    risks: selectRiskRows(state, entry.id),
    inconsistencies: selectInconsistencyRows(state, entry.id),
    gaps,
    report,
  };
}

/** Trust/audit data: what the pipeline did and what it refused to accept. */
export function selectTrustSummary(state) {
  const entry = selectActiveEntry(state);
  const report = entry?.extractionReport ?? null;
  const validation = entry?.validation ?? null;
  return {
    ai: state?.ai ?? null,
    provider: report?.provider ?? null,
    schemaVersion: report?.schemaVersion ?? null,
    graphGeneratedAt: entry?.graph?.generatedAt ?? null,
    loadedAt: entry?.loadedAt ?? null,
    accepted: report?.accepted ?? null,
    counts: report
      ? {
          chunkCount: report.chunkCount,
          draftItemCount: report.draftItemCount,
          derivedRelationshipCount: report.derivedRelationshipCount,
        }
      : null,
    dropped: report?.droppedItems ?? {},
    rejectedRelationships: report?.rejectedRelationships ?? [],
    evidence: report?.evidence ?? null,
    validation: validation?.summary ?? report?.validation ?? null,
    validationWarnings: validation?.warnings ?? [],
    validationIssues: validation?.issues ?? [],
    notes: report?.notes ?? [],
    injectionWarnings: report?.injectionWarnings ?? [],
    chunks: report?.chunks ?? [],
    chunkStats: report?.chunkStats ?? null,
  };
}

/** Compact clause outline for outline/list panels. */
export function selectClauseOutline(state, documentId = null) {
  const model = selectModel(state, documentId);
  if (!model) return [];
  const factClauseIds = new Set((model.obligations ?? []).map((entry) => entry.clauseId).filter(Boolean));
  return (model.clauses ?? []).map((clause) => ({
    id: clause.id,
    number: clause.number,
    heading: clause.heading,
    level: clause.level,
    page: clause.page,
    charCount: clause.text?.length ?? 0,
    hasObligations: factClauseIds.has(clause.id),
    crossReferenceCount: (clause.crossReferences ?? []).length,
  }));
}

export function selectNotices(state) {
  return state?.notices ?? [];
}

export function selectGraphNodeGroups(state, documentId = null) {
  const graph = selectGraphOrBuild(state, documentId);
  if (!graph) return {};
  return graph.nodes.reduce((groups, node) => {
    groups[node.entityType] = [...(groups[node.entityType] ?? []), node];
    return groups;
  }, {});
}

export function selectGraphNodeOptions(state, documentId = null) {
  const graph = selectGraphOrBuild(state, documentId);
  return (graph?.nodes ?? []).map((node) => ({
    id: node.id,
    label: node.label,
    entityType: node.entityType,
  }));
}

export function selectNodesOfTypes(state, types, documentId = null) {
  const graph = selectGraphOrBuild(state, documentId);
  return graph ? getNodesByType(graph, types) : [];
}

export function selectPartyRows(state, documentId = null) {
  const model = selectModel(state, documentId);
  if (!model) return [];
  return (model.parties ?? []).map((party) => ({
    party,
    obligationCount: (model.obligations ?? []).filter(
      (obligation) => obligation.obligorPartyId === party.id,
    ).length,
    rightCount: (model.rights ?? []).filter((right) => right.holderPartyId === party.id).length,
  }));
}

export function selectDefinitions(state, documentId = null) {
  return selectModel(state, documentId)?.definitions ?? [];
}

export function selectRights(state, documentId = null) {
  return selectModel(state, documentId)?.rights ?? [];
}

export function selectConditions(state, documentId = null) {
  return selectModel(state, documentId)?.conditions ?? [];
}

export function selectDeadlines(state, documentId = null) {
  return selectModel(state, documentId)?.deadlines ?? [];
}

export function selectConsequences(state, documentId = null) {
  return selectModel(state, documentId)?.consequences ?? [];
}

/** Distance-based highlight set for the graph view. */
export function selectGraphFocusSet(graph, focusNodeId, depth = 1) {
  if (!graph || !focusNodeId) return new Set();
  const ids = new Set([focusNodeId]);
  let frontier = [focusNodeId];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const id of frontier) {
      for (const relationship of graph.relationships ?? []) {
        const neighbour =
          relationship.fromId === id
            ? relationship.toId
            : relationship.toId === id
              ? relationship.fromId
              : null;
        if (neighbour && !ids.has(neighbour)) {
          ids.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* Phase 3 view models                                                        */
/* -------------------------------------------------------------------------- */

/** Deterministic risk signals plus the findings the provider proposed. */
export function selectSignals(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  if (!model) return null;
  return collectRiskSignals(model, options);
}

/** Deterministic potential inconsistencies plus the ones the provider proposed. */
export function selectInconsistencyFindings(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  if (!model) return null;
  return collectInconsistencies(model, options);
}

/**
 * The graph the Phase 3 view draws: the validated graph plus the derived risk
 * signals and inconsistencies, so findings are typed nodes with evidence rather
 * than a separate list.
 */
export function selectGraphWithFindings(state, documentId = null, options = {}) {
  const graph = selectGraphOrBuild(state, documentId);
  if (!graph) return null;
  const signals = selectSignals(state, documentId, options);
  const findings = selectInconsistencyFindings(state, documentId, options);
  return augmentGraphWithFindings(graph, {
    signals: signals?.signals ?? [],
    inconsistencies: findings?.detected ?? [],
  });
}

/** Everything the graph route renders, in one pure view model. */
export function selectGraphViewModel(state, documentId = null, options = {}) {
  const graph = selectGraphWithFindings(state, documentId, options);
  if (!graph) return null;
  const mode = options.mode ?? 'focused';
  const view = mode === 'full' ? buildGraphViewModel(graph, options) : buildFocusedGraphViewModel(graph, options);
  return { ...view, summary: summarizeGraphViewModel(view) };
}

export function selectGraphTopics(state, documentId = null) {
  const graph = selectGraphOrBuild(state, documentId);
  return graph ? suggestGraphTopics(graph) : [];
}

export function selectObligationBoard(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  return model ? buildObligationBoard(model, options) : null;
}

export function selectRightsBoard(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  return model ? buildRightsBoard(model, options) : null;
}

export function selectTimelineView(state, documentId = null, options = {}) {
  const model = selectModel(state, documentId);
  return model ? buildTimelineView(model, options) : null;
}

export { ENTITY_TYPES };

