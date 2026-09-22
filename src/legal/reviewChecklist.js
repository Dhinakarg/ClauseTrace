/**
 * Review checklist.
 *
 * Builds the preparation checklist from what the pipeline ALREADY knows it could
 * not settle: unresolved dates, missing citations, rejected facts, flagged risks
 * and detected inconsistencies, plus the questions a reader should put to the
 * other side. Deterministic and pure — no AI, no guessing.
 */

import { ENTITY_TYPES, getEntitiesByType } from './schema.js';
import { DUE_SOON_DAYS, assessAllObligations, toISODateString } from './obligationEngine.js';
import { collectRiskSignals } from './riskRules.js';
import { collectInconsistencies } from './inconsistencyRules.js';
import { buildImpactMap } from './impactEngine.js';
import { CHANGE_TYPES, CHANGE_TYPE_META } from './compareEngine.js';
import { summarizeEvidenceCoverage } from '../documents/evidence.js';
import { truncateText } from '../security/limits.js';

export const CHECKLIST_CATEGORIES = Object.freeze({
  GAP: 'gap',
  OVERDUE: 'overdue',
  DUE_SOON: 'due-soon',
  UNDATED: 'undated',
  EVIDENCE: 'evidence',
  RISK: 'risk',
  INCONSISTENCY: 'inconsistency',
  PROVIDER: 'provider',
  CONFIRM: 'confirm',
});

const CATEGORY_LABELS = Object.freeze({
  gap: 'Data gaps',
  overdue: 'Past due',
  'due-soon': 'Coming up',
  undated: 'Timing unclear',
  evidence: 'Citation problems',
  risk: 'Risk signals to review',
  inconsistency: 'Inconsistencies to resolve',
  provider: 'Extraction integrity',
  confirm: 'Confirm with the other side',
});

/** Severity ordering, most urgent first. Kept here to avoid a UI import. */
const SEVERITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
});

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.unknown;
}

export function checklistCategoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category;
}

function createItem({ category, severity, title, detail, entityId = null, clauseId = null, source = null }) {
  return {
    id: `${category}:${entityId ?? clauseId ?? title}`,
    category,
    severity,
    title,
    detail,
    entityId,
    clauseId,
    source,
  };
}

/**
 * Builds checklist items from a model plus the extraction report.
 * `report` is the `runExtraction` report (may be null for fixture-loaded data).
 */
export function buildReviewChecklist(model, report = null, options = {}) {
  const items = [];
  if (!model) return items;

  const { assessments } = assessAllObligations(model, options);
  const clauseById = new Map(
    getEntitiesByType(model, ENTITY_TYPES.CLAUSE).map((clause) => [clause.id, clause]),
  );
  const clauseRef = (clauseId) => {
    const clause = clauseId ? clauseById.get(clauseId) : null;
    if (!clause) return null;
    return clause.number ? `§${clause.number}` : clause.heading ?? null;
  };

  for (const obligation of getEntitiesByType(model, ENTITY_TYPES.OBLIGATION)) {
    const assessment = assessments.get(obligation.id);
    if (assessment.status === 'overdue') {
      items.push(
        createItem({
          category: CHECKLIST_CATEGORIES.OVERDUE,
          severity: 'critical',
          title: obligation.summary,
          detail: `Deadline passed on ${assessment.dueDate}. Confirm whether performance happened and whether any grace period applies.`,
          entityId: obligation.id,
          clauseId: obligation.clauseId,
          source: clauseRef(obligation.clauseId),
        }),
      );
    } else if (assessment.status === 'due') {
      items.push(
        createItem({
          category: CHECKLIST_CATEGORIES.DUE_SOON,
          severity: 'warning',
          title: obligation.summary,
          detail: `Falls due on ${assessment.dueDate}, inside the ${DUE_SOON_DAYS}-day window.`,
          entityId: obligation.id,
          clauseId: obligation.clauseId,
          source: clauseRef(obligation.clauseId),
        }),
      );
    } else if (!assessment.hasDeadline && assessment.status !== 'informational') {
      items.push(
        createItem({
          category: CHECKLIST_CATEGORIES.UNDATED,
          severity: 'info',
          title: obligation.summary,
          detail: assessment.reason ?? 'No usable timing was extracted.',
          entityId: obligation.id,
          clauseId: obligation.clauseId,
          source: clauseRef(obligation.clauseId),
        }),
      );
    }
  }

  for (const deadline of getEntitiesByType(model, ENTITY_TYPES.DEADLINE)) {
    if (deadline.date || deadline.offset || deadline.recurrence) continue;
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.UNDATED,
        severity: 'info',
        title: deadline.description ?? 'Deadline without a date',
        detail:
          'The document mentions a deadline but the extraction recorded no date, offset or recurrence.',
        entityId: deadline.id,
        clauseId: deadline.clauseId,
        source: clauseRef(deadline.clauseId),
      }),
    );
  }

  for (const risk of getEntitiesByType(model, ENTITY_TYPES.RISK)) {
    if (severityRank(risk.severity) > severityRank('medium')) continue;
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.RISK,
        severity: risk.severity,
        title: risk.title,
        detail: risk.explanation || 'Flagged as a risk signal; confirm the reading against the clause.',
        entityId: risk.id,
        clauseId: risk.clauseId,
        source: clauseRef(risk.clauseId),
      }),
    );
  }

  for (const inconsistency of getEntitiesByType(model, ENTITY_TYPES.INCONSISTENCY)) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.INCONSISTENCY,
        severity: inconsistency.severity,
        title: inconsistency.title,
        detail:
          inconsistency.description ||
          'Two clauses appear to conflict. Decide which governs, or amend the document.',
        entityId: inconsistency.id,
        clauseId: inconsistency.clauseId,
        source: (inconsistency.clauseIds ?? []).map(clauseRef).filter(Boolean).join(' / ') || null,
      }),
    );
  }

  if (report?.evidence?.rejectedEntities > 0) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.EVIDENCE,
        severity: 'warning',
        title: `${report.evidence.rejectedEntities} proposed fact(s) were dropped`,
        detail:
          'Their quoted source text could not be matched to the document, so they were excluded from the workspace.',
        source: report.provider?.name ?? 'extraction report',
      }),
    );
  }

  for (const rejection of report?.rejectedRelationships ?? []) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.EVIDENCE,
        severity: 'info',
        title: 'Relationship rejected',
        detail: rejection.reason,
        source: rejection.relationship?.type ?? 'relationship validation',
      }),
    );
  }

  if ((report?.injectionWarnings ?? []).length > 0) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.PROVIDER,
        severity: 'info',
        title: `${report.injectionWarnings.length} instruction-like passage(s) neutralised`,
        detail:
          'The document contained text shaped like instructions to an AI. It was defused before analysis; review the excerpts to decide whether it is boilerplate or something else.',
        source: report.provider?.name ?? 'prompt safety',
      }),
    );
  }

  if (report && report.accepted === false) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.PROVIDER,
        severity: 'warning',
        title: 'Extraction did not pass validation',
        detail:
          'The extraction failed schema validation, so it was not applied. Check the extraction report for the error list.',
        source: report.provider?.name ?? 'validation',
      }),
    );
  }

  const parties = getEntitiesByType(model, ENTITY_TYPES.PARTY);
  const obligationsWithoutParty = getEntitiesByType(model, ENTITY_TYPES.OBLIGATION).filter(
    (obligation) => !obligation.obligorPartyId,
  );

  if (parties.length > 0) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.CONFIRM,
        severity: 'info',
        title: 'Confirm the party identities and roles',
        detail: `Extracted parties: ${parties
          .map((party) => party.name)
          .join(', ')}. Verify entity names, jurisdictions and registered details.`,
      }),
    );
  }

  if (obligationsWithoutParty.length > 0) {
    items.push(
      createItem({
        category: CHECKLIST_CATEGORIES.CONFIRM,
        severity: 'warning',
        title: `${obligationsWithoutParty.length} obligation(s) have no identified obligor`,
        detail: 'The clause wording does not name a party clearly enough to attribute the duty.',
        source:
          obligationsWithoutParty
            .map((obligation) => clauseRef(obligation.clauseId))
            .filter(Boolean)
            .join(', ') || null,
      }),
    );
  }

  return items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** Groups checklist items by category, preserving the sorted order. */
export function groupChecklistItems(items = []) {
  const groups = new Map();
  for (const entry of items) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return groups;
}

/** Plain-text rendering for the copy-to-clipboard action. */
export function checklistToText(items = [], { title = 'Review preparation' } = {}) {
  const lines = [title, ''];
  let currentCategory = null;
  for (const entry of items) {
    if (entry.category !== currentCategory) {
      currentCategory = entry.category;
      lines.push(`${checklistCategoryLabel(currentCategory)}:`);
    }
    lines.push(`- [ ] ${entry.title}${entry.source ? ` (${entry.source})` : ''}`);
    if (entry.detail) lines.push(`      ${entry.detail}`);
  }
  lines.push('', 'Prepared from extracted document text. Not legal advice.');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Preparation plan (Phase 5)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The four sections a reader prepares from. They are deliberately separate: a
 * question to put to the other side is not the same thing as a fact to look up,
 * a clause worth discussing or a change between two versions.
 */
export const PREP_SECTIONS = Object.freeze({
  QUESTIONS: 'questions',
  FACTS: 'facts',
  CLAUSES: 'clauses',
  CHANGES: 'changes',
});

export const PREP_SECTION_ORDER = Object.freeze([
  PREP_SECTIONS.QUESTIONS,
  PREP_SECTIONS.FACTS,
  PREP_SECTIONS.CLAUSES,
  PREP_SECTIONS.CHANGES,
]);

export const PREP_SECTION_LABELS = Object.freeze({
  [PREP_SECTIONS.QUESTIONS]: 'Questions to ask',
  [PREP_SECTIONS.FACTS]: 'Facts to gather',
  [PREP_SECTIONS.CLAUSES]: 'Clauses to discuss',
  [PREP_SECTIONS.CHANGES]: 'Changes to discuss',
});

export const PREP_SECTION_DESCRIPTIONS = Object.freeze({
  [PREP_SECTIONS.QUESTIONS]:
    'Open points the extracted text raises, phrased as something to ask rather than something to assume.',
  [PREP_SECTIONS.FACTS]:
    'Details the document does not settle: identities, timing, citations and anything the pipeline had to withhold.',
  [PREP_SECTIONS.CLAUSES]:
    'The clauses carrying those open points, each with the reason it is on the list.',
  [PREP_SECTIONS.CHANGES]:
    'What differs between this version and another loaded version, and which other records each change reaches.',
});

export const PREPARE_DISCLAIMER =
  'A preparation checklist built from the extracted text. It is not legal advice, it decides nothing, and every item should be confirmed against the clauses it cites.';

export const PREPARE_EMPTY_NOTE = Object.freeze({
  [PREP_SECTIONS.QUESTIONS]: 'No open questions were derived from the extracted text of this document.',
  [PREP_SECTIONS.FACTS]: 'No missing facts were detected in this extraction.',
  [PREP_SECTIONS.CLAUSES]: 'No clause carries an open point in this extraction.',
  [PREP_SECTIONS.CHANGES]:
    'Load a second version of the agreement and compare it to list the changes worth discussing.',
});

/** One checklist entry. `question` is present when the item is something to ask. */
function createPrepItem({
  section,
  severity = 'info',
  title,
  detail = null,
  question = null,
  entityId = null,
  clauseId = null,
  clauseIds = null,
  source = null,
  ruleId = null,
  evidence = [],
}) {
  const id = `${section}:${ruleId ? `${ruleId}|` : ''}${entityId ?? clauseId ?? title}`;
  return {
    id,
    section,
    severity,
    title,
    detail,
    question,
    entityId,
    clauseId: clauseId ?? clauseIds?.[0] ?? null,
    clauseIds: clauseIds ?? (clauseId ? [clauseId] : []),
    source,
    ruleId,
    evidence,
  };
}

function emptySection(id) {
  return {
    id,
    label: PREP_SECTION_LABELS[id],
    description: PREP_SECTION_DESCRIPTIONS[id],
    items: [],
    counts: { total: 0, bySeverity: {} },
    note: null,
  };
}

function countBySeverity(items) {
  const counts = {};
  for (const item of items) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
  return counts;
}

/** Curried helper: clause id → compact “§1.1” reference, or null. */
function compactClauseRef(model) {
  const clauses = new Map((model?.clauses ?? []).map((clause) => [clause.id, clause]));
  return (clauseId) => {
    const clause = clauseId ? clauses.get(clauseId) : null;
    if (!clause) return null;
    return clause.number ? `§${clause.number}` : clause.heading ?? null;
  };
}

/** Questions a reader should put to the other side, derived from the model. */
function buildQuestionItems({ model, obligations, assessments, signals, findings }) {
  const items = [];

  for (const obligation of obligations) {
    const assessment = assessments.get(obligation.id);
    if (!assessment) continue;
    if (!assessment.hasDeadline && assessment.status !== 'informational') {
      items.push(
        createPrepItem({
          section: PREP_SECTIONS.QUESTIONS,
          severity: assessment.status === 'unknown' ? 'medium' : 'low',
          title: `When is this due: ${obligation.summary}`,
          question: `When must “${obligation.summary}” be performed, and what starts the clock?`,
          detail: assessment.reason ?? 'The document states the duty but no usable timing was extracted.',
          entityId: obligation.id,
          clauseId: obligation.clauseId,
          evidence: obligation.evidence ?? [],
        }),
      );
    }
    if (!obligation.obligorPartyId) {
      items.push(
        createPrepItem({
          section: PREP_SECTIONS.QUESTIONS,
          severity: 'medium',
          title: `Who owes this: ${obligation.summary}`,
          question: `Which party is responsible for “${obligation.summary}”?`,
          detail: 'The clause wording did not name a party clearly enough to attribute the duty.',
          entityId: `${obligation.id}:obligor`,
          clauseId: obligation.clauseId,
          evidence: obligation.evidence ?? [],
        }),
      );
    }
  }

  for (const signal of signals) {
    if (severityRank(signal.severity) > severityRank('medium')) continue;
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.QUESTIONS,
        severity: signal.severity,
        title: signal.title,
        question: `What does the document intend with “${signal.detection?.ruleLabel ?? signal.title}”${
          signal.clauseNumber ? ` in §${signal.clauseNumber}` : ''
        }?`,
        detail: signal.explanation ?? signal.detection?.why ?? null,
        entityId: signal.id,
        clauseId: signal.clauseId,
        ruleId: signal.detection?.ruleId ?? null,
        evidence: signal.evidence ?? [],
      }),
    );
  }

  for (const finding of findings) {
    const refs = (finding.clauseIds ?? []).map(compactClauseRef(model)).filter(Boolean);
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.QUESTIONS,
        severity: finding.severity,
        title: finding.title,
        question:
          refs.length > 1
            ? `Which provision governs — ${refs.join(' or ')}?`
            : `How should “${finding.title}” be resolved?`,
        detail: finding.detail ?? finding.description ?? null,
        entityId: finding.id,
        clauseId: finding.clauseId,
        clauseIds: finding.clauseIds ?? [],
        ruleId: finding.detection?.ruleId ?? null,
        evidence: finding.evidence ?? [],
      }),
    );
  }

  return items;
}

/** Facts a reader must obtain or confirm before relying on the extraction. */
function buildFactItems({ model, obligations, report }) {
  const items = [];
  const ref = compactClauseRef(model);
  const coverage = summarizeEvidenceCoverage(model);

  for (const party of getEntitiesByType(model, ENTITY_TYPES.PARTY)) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'info',
        title: `Confirm the identity of ${party.name}`,
        detail: `Recorded as ${party.role ?? 'role unknown'}${
          party.entityKind ? `, ${party.entityKind}` : ''
        }. Check the legal name, entity kind and jurisdiction against the register before relying on it.`,
        entityId: party.id,
        evidence: party.evidence ?? [],
      }),
    );
  }

  const noObligor = obligations.filter((obligation) => !obligation.obligorPartyId);
  if (noObligor.length > 0) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'medium',
        title: `${noObligor.length} obligation(s) have no identified obligor`,
        detail: 'The extracted wording does not attribute these duties to a party, so the responsible side must be confirmed.',
        entityId: 'facts:no-obligor',
        clauseIds: noObligor.map((obligation) => obligation.clauseId).filter(Boolean),
        source:
          noObligor
            .map((obligation) => ref(obligation.clauseId))
            .filter(Boolean)
            .join(', ') || null,
      }),
    );
  }

  for (const deadline of getEntitiesByType(model, ENTITY_TYPES.DEADLINE)) {
    if (deadline.date || deadline.offset || deadline.recurrence) continue;
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'medium',
        title: `Find the timing for: ${deadline.description ?? 'a deadline the document mentions'}`,
        detail: 'No date, offset or recurrence was extracted, so the deadline cannot be placed on the calendar.',
        entityId: deadline.id,
        clauseId: deadline.clauseId,
        evidence: deadline.evidence ?? [],
      }),
    );
  }

  for (const definition of getEntitiesByType(model, ENTITY_TYPES.DEFINITION)) {
    if (definition.text && String(definition.text).trim().length > 0) continue;
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'low',
        title: `Find the definition of “${definition.term}”`,
        detail: 'The term is recorded as defined, but its wording was not captured.',
        entityId: definition.id,
        clauseId: definition.clauseId,
        evidence: definition.evidence ?? [],
      }),
    );
  }

  if (coverage.unverified > 0) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'warning',
        title: `${coverage.unverified} extracted fact(s) lack a verified citation`,
        detail: 'Their quoted source text could not be matched to the parsed document, so treat them as unconfirmed.',
        entityId: 'facts:unverified',
      }),
    );
  }

  const rejected = report?.evidence?.rejectedEntities ?? 0;
  if (rejected > 0) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'warning',
        title: `Ask for source text for ${rejected} dropped fact(s)`,
        detail: 'The provider proposed these facts, but their quoted text was not found in the document, so they were withheld.',
        entityId: 'facts:rejected',
        source: report?.provider?.name ?? 'extraction report',
      }),
    );
  }

  for (const collection of Object.keys(report?.droppedItems ?? {})) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'info',
        title: `${report.droppedItems[collection]} item(s) dropped from ${collection}`,
        detail: 'The response parser rejected these entries because they did not match the expected shape.',
        entityId: `facts:dropped:${collection}`,
        source: report?.provider?.name ?? 'response parser',
      }),
    );
  }

  const rejectedRelationships = (report?.rejectedRelationships ?? []).length;
  if (rejectedRelationships > 0) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'info',
        title: `Confirm ${rejectedRelationships} connection(s) the pipeline rejected`,
        detail: 'These relationships referenced entities that could not be resolved, so they were not applied.',
        entityId: 'facts:rejected-relationships',
      }),
    );
  }

  const injectionWarnings = (report?.injectionWarnings ?? []).length;
  if (injectionWarnings > 0) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'info',
        title: `Review ${injectionWarnings} instruction-like passage(s) in the document`,
        detail: 'Text shaped like instructions to an AI was neutralised before analysis. Decide whether it is boilerplate or something else.',
        entityId: 'facts:injection',
        source: report?.provider?.name ?? 'prompt safety',
      }),
    );
  }

  if (report && report.accepted === false) {
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.FACTS,
        severity: 'warning',
        title: 'Re-run extraction: the last result failed validation',
        detail: 'The extraction did not pass schema validation and was not applied, so the model in the workspace may be incomplete.',
        entityId: 'facts:validation',
        source: report?.provider?.name ?? 'validation',
      }),
    );
  }

  return items;
}

/**
 * Clauses worth discussing, aggregated by clause so the same clause never appears
 * twice with two different reasons: each entry keeps the full list of reasons it
 * was collected for.
 */
function buildClauseItems({ model, clauses, assessments, obligations, signals, findings }) {
  const ref = compactClauseRef(model);
  const collected = new Map();
  const add = (clauseId, severity, reason) => {
    if (!clauseId) return;
    const entry = collected.get(clauseId) ?? { clauseId, severity: 'info', reasons: [], evidence: [] };
    if (severityRank(severity) < severityRank(entry.severity)) entry.severity = severity;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    collected.set(clauseId, entry);
  };

  for (const signal of signals) {
    add(signal.clauseId, signal.severity, `Risk signal: ${signal.title}`);
  }
  for (const finding of findings) {
    for (const clauseId of finding.clauseIds ?? []) {
      add(clauseId, finding.severity, `Potential inconsistency: ${finding.title}`);
    }
  }
  for (const obligation of obligations) {
    const assessment = assessments.get(obligation.id);
    if (assessment && !assessment.hasDeadline && assessment.status !== 'informational') {
      add(obligation.clauseId, 'medium', `Timing unclear: ${obligation.summary}`);
    }
    if (!obligation.obligorPartyId) {
      add(obligation.clauseId, 'medium', `Obligor not identified: ${obligation.summary}`);
    }
  }

  const clauseById = new Map(clauses.map((clause) => [clause.id, clause]));
  const items = [];
  for (const entry of collected.values()) {
    const clause = clauseById.get(entry.clauseId);
    if (!clause) continue;
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.CLAUSES,
        severity: entry.severity,
        title: clause.number
          ? `§${clause.number}${clause.heading ? ` — ${clause.heading}` : ''}`
          : clause.heading ?? 'Unnumbered clause',
        detail: entry.reasons.join(' '),
        entityId: `clause:${entry.clauseId}`,
        clauseId: entry.clauseId,
        source: ref(entry.clauseId),
      }),
    );
  }

  for (const clause of clauses) {
    if (collected.has(clause.id)) continue;
    if (clause.type !== 'unknown') continue;
    items.push(
      createPrepItem({
        section: PREP_SECTIONS.CLAUSES,
        severity: 'info',
        title: clause.number ? `§${clause.number} — unclassified clause` : 'Unclassified clause',
        detail: 'The clause could not be typed from its wording, so its role in the agreement has to be read rather than assumed.',
        entityId: `clause:${clause.id}`,
        clauseId: clause.id,
        source: ref(clause.id),
      }),
    );
  }

  return items;
}

/** Changes between two loaded versions, with what each change reaches. */
function buildChangeItems({ comparison }) {
  if (!comparison || comparison.ok === false) return [];
  const changes = (comparison.changes ?? []).filter(
    (change) => change.changeType !== CHANGE_TYPES.UNCHANGED,
  );
  if (changes.length === 0) return [];

  const impacts = buildImpactMap(comparison, { maxDepth: 1 });
  return changes.map((change) => {
    const impact = impacts.get(change.id) ?? null;
    const label = CHANGE_TYPE_META[change.changeType]?.label ?? change.changeType;
    const after = change.evidence?.after ?? [];
    const before = change.evidence?.before ?? [];
    return createPrepItem({
      section: PREP_SECTIONS.CHANGES,
      severity: 'info',
      title: `${label}: ${truncateText(change.label ?? change.key ?? 'record', 90)}`,
      detail: [change.summary, impact?.summary].filter(Boolean).join(' '),
      entityId: change.id,
      clauseIds: change.clauseIds ?? [],
      ruleId: change.changeType,
      evidence: after.length > 0 ? after : before,
    });
  });
}

/**
 * Builds the four preparation sections for one document.
 *
 * Everything is derived from the model, the extraction report and (optionally) a
 * comparison between two versions. No AI is called here: the plan is a
 * deterministic re-reading of what the pipeline already recorded, so the same
 * inputs always produce the same checklist.
 */
export function buildPreparationPlan(model, report = null, options = {}) {
  const { comparison = null, comparisonLabels = null, maxPerSection = 12, ...analysisOptions } = options;
  const sections = PREP_SECTION_ORDER.map(emptySection);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const todayISO = toISODateString(analysisOptions.today ?? new Date());

  if (model) {
    const clauses = getEntitiesByType(model, ENTITY_TYPES.CLAUSE);
    const obligations = getEntitiesByType(model, ENTITY_TYPES.OBLIGATION);
    const { assessments } = assessAllObligations(model, analysisOptions);
    const riskCollection = collectRiskSignals(model, analysisOptions);
    const risks = [...riskCollection.signals, ...riskCollection.modelRisks];
    const findings = collectInconsistencies(model, analysisOptions).all;

    byId.get(PREP_SECTIONS.QUESTIONS).items = buildQuestionItems({
      model,
      obligations,
      assessments,
      signals: risks,
      findings,
    });
    byId.get(PREP_SECTIONS.FACTS).items = buildFactItems({ model, obligations, report });
    byId.get(PREP_SECTIONS.CLAUSES).items = buildClauseItems({
      model,
      clauses,
      assessments,
      obligations,
      signals: risks,
      findings,
    });
    byId.get(PREP_SECTIONS.CHANGES).items = buildChangeItems({ comparison });
  }

  for (const section of sections) {
    const seen = new Set();
    section.items = section.items
      .filter((item) => (seen.has(item.id) ? false : seen.add(item.id) && true))
      .sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id),
      )
      .slice(0, maxPerSection);
    section.counts = { total: section.items.length, bySeverity: countBySeverity(section.items) };
    if (section.items.length === 0) section.note = PREPARE_EMPTY_NOTE[section.id];
  }

  const changeCount = (comparison?.changes ?? []).filter(
    (change) => change.changeType !== CHANGE_TYPES.UNCHANGED,
  ).length;

  return {
    sections,
    counts: {
      total: sections.reduce((sum, section) => sum + section.items.length, 0),
      bySection: Object.fromEntries(sections.map((section) => [section.id, section.items.length])),
      bySeverity: countBySeverity(sections.flatMap((section) => section.items)),
    },
    generatedFor: todayISO,
    documentTitle: model?.documents?.[0]?.title ?? null,
    comparison: {
      available: Boolean(comparison && comparison.ok !== false),
      versionA: comparisonLabels?.a ?? null,
      versionB: comparisonLabels?.b ?? null,
      changeCount,
    },
    disclaimer: PREPARE_DISCLAIMER,
  };
}

/** Counts and empty sections, for the summary tiles. */
export function summarizePreparation(plan) {
  if (!plan) {
    return {
      total: 0,
      bySection: {},
      bySeverity: {},
      emptySections: PREP_SECTION_ORDER.slice(),
      changeCount: 0,
      comparisonAvailable: false,
      generatedFor: null,
    };
  }
  return {
    ...plan.counts,
    emptySections: plan.sections
      .filter((section) => section.items.length === 0)
      .map((section) => section.id),
    changeCount: plan.comparison.changeCount,
    comparisonAvailable: plan.comparison.available,
    generatedFor: plan.generatedFor,
  };
}

/** Plain-text rendering of the whole plan, for copy and export. */
export function preparationToText(plan, { title = 'Review preparation' } = {}) {
  const lines = [title];
  if (plan?.documentTitle) lines.push(plan.documentTitle);
  if (plan?.generatedFor) lines.push(`Prepared ${plan.generatedFor}`);

  for (const section of plan?.sections ?? []) {
    lines.push('', `${section.label}:`);
    if (section.items.length === 0) {
      lines.push(`- [ ] ${section.note ?? 'Nothing to review.'}`);
      continue;
    }
    for (const item of section.items) {
      const suffix = item.source ? ` (${item.source})` : '';
      lines.push(`- [ ] ${item.question ?? item.title}${suffix}`);
      if (item.detail) lines.push(`      ${item.detail}`);
    }
  }

  lines.push('', 'Prepared from extracted document text. Not legal advice.');
  return lines.join('\n');
}

