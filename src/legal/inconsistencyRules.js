/**
 * Inconsistency detection.
 *
 * Deterministic, pair-wise comparisons inside a single validated LegalModel:
 * two notice periods that disagree, two dates for the same event, one term
 * defined twice in different words, duplicated duties, references that point at
 * clauses which do not exist.
 *
 * Every finding is framed as a potential inconsistency, never a conclusion:
 * the wording the UI shows is `INCONSISTENCY_HEADLINE`, each finding carries the
 * two sides it compared (`comparison`) and the phrases that made it fire
 * (`detection.basis`).
 */

import { ENTITY_TYPES, PROVENANCE, createEntityId } from './schema.js';
import { SIGNAL_SOURCES, buildSignalContext, clauseLabel, clauseText, textForEntity } from './riskRules.js';
import {
  capitalizedTerms,
  extractPeriods,
  matchAll,
  mergeEvidence,
  normalizePhrase,
  normalizeText,
  quotedTerms,
  sortBySeverity,
  truncate,
} from './signalSupport.js';

/** The wording every finding is presented with. */
export const INCONSISTENCY_HEADLINE = 'Potential inconsistency detected.';

export const INCONSISTENCY_DISCLAIMER =
  'These are potential inconsistencies found by comparing the extracted entities with each other. A person should read the cited clauses before relying on any of them.';

export const INCONSISTENCY_RULES = Object.freeze([
  {
    id: 'conflicting-notice-periods',
    label: 'Notice periods that disagree',
    inconsistencyType: 'conflicting-notice-periods',
    severity: 'high',
    why: 'Two provisions about the same action state different notice periods, so which one applies is unclear from the text alone.',
  },
  {
    id: 'contradictory-dates',
    label: 'Two dates for the same event',
    inconsistencyType: 'contradictory-dates',
    severity: 'high',
    why: 'Two deadlines describe the same event but carry different calendar dates.',
  },
  {
    id: 'conflicting-terms',
    label: 'One term defined twice',
    inconsistencyType: 'conflicting-terms',
    severity: 'high',
    why: 'The same defined term is defined more than once with different wording, so which definition governs is unclear.',
  },
  {
    id: 'undefined-term',
    label: 'Defined-style term without a definition',
    inconsistencyType: 'undefined-term',
    severity: 'medium',
    why: 'The document marks a term as defined (quoted or consistently capitalised) but no definition entity records what it means.',
  },
  {
    id: 'duplicate-obligation',
    label: 'The same duty recorded twice',
    inconsistencyType: 'duplicate-obligation',
    severity: 'medium',
    why: 'Two obligations place the same duty on the same party in different clauses.',
  },
  {
    id: 'missing-cross-reference',
    label: 'Reference to a clause that is not in the document',
    inconsistencyType: 'missing-cross-reference',
    severity: 'medium',
    why: 'The document refers to another clause by number, but no clause with that number was extracted.',
  },
  {
    id: 'orphan-clause-reference',
    label: 'Entity pointing at a clause that is not present',
    inconsistencyType: 'orphan-clause-reference',
    severity: 'low',
    why: 'An extracted entity links to a clause id that is not in this document, so the link cannot be followed.',
  },
]);

export const INCONSISTENCY_RULE_IDS = Object.freeze(INCONSISTENCY_RULES.map((rule) => rule.id));

const RULE_BY_ID = new Map(INCONSISTENCY_RULES.map((rule) => [rule.id, rule]));

/** Types of notice-style provision, used to group comparable notice periods. */
const NOTICE_CLAUSE_TYPES = new Set(['notice', 'termination', 'renewal', 'term', 'suspension']);

const NOTICE_WORDS = /notice|notify|notification/i;

/* -------------------------------------------------------------------------- */
/* Comparison support                                                         */
/* -------------------------------------------------------------------------- */

/** Which action a notice provision governs, for like-for-like comparison. */
function noticeActionKey(clause) {
  const text = clauseText(clause);
  if (/terminat/i.test(text)) return 'termination';
  if (/renew/i.test(text)) return 'renewal';
  if (/suspend/i.test(text)) return 'suspension';
  if (NOTICE_WORDS.test(text)) return 'notice';
  return 'other';
}

/**
 * Periods stated immediately next to notice wording, e.g. "may terminate on
 * thirty (30) days' written notice". Only calendar-exact units are compared, so
 * "2 months" never silently becomes "60 days".
 */
export function noticePeriodStatements(clause) {
  const text = clauseText(clause);
  const statements = [];
  for (const period of extractPeriods(text)) {
    const before = text.slice(Math.max(0, period.index - 60), period.index);
    const after = text.slice(period.index + period.phrase.length, period.index + period.phrase.length + 30);
    if (!NOTICE_WORDS.test(before) && !NOTICE_WORDS.test(after)) continue;
    statements.push({
      clauseId: clause.id,
      clauseNumber: clause.number,
      label: clauseLabel(clause),
      days: period.days,
      exact: period.exact,
      phrase: period.phrase,
      action: noticeActionKey(clause),
      entityId: clause.id,
      entityType: clause.type,
    });
  }
  return statements;
}

/** All comparable notice statements in the model: clauses and deadlines. */
export function collectNoticeStatements(context) {
  const statements = [];
  for (const clause of context.clauses) {
    if (!NOTICE_WORDS.test(clauseText(clause)) && !NOTICE_CLAUSE_TYPES.has(clause.clauseType)) continue;
    statements.push(...noticePeriodStatements(clause));
  }
  for (const deadline of context.deadlines) {
    const clause = deadline.clauseId ? context.clauseById.get(deadline.clauseId) : null;
    if (!NOTICE_WORDS.test(`${deadline.description ?? ''} ${clauseText(clause)}`)) continue;
    const scope = normalizeText(`${deadline.description ?? ''} ${clauseText(clause)}`);
    for (const period of extractPeriods(scope)) {
      statements.push({
        clauseId: deadline.clauseId,
        clauseNumber: clause?.number ?? null,
        label: clauseLabel(clause),
        days: period.days,
        exact: period.exact,
        phrase: period.phrase,
        action: clause ? noticeActionKey(clause) : 'notice',
        entityId: deadline.id,
        entityType: deadline.type,
        deadlineId: deadline.id,
      });
    }
  }
  return statements;
}

/** Key that treats two deadlines as describing the same event. */
export function deadlineEventKey(deadline) {
  const raw = normalizeText(deadline?.event ?? deadline?.anchorEvent ?? deadline?.description ?? '');
  const withoutPeriods = raw
    .replace(/\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b/gi, '')
    .replace(/\bwithin\b/gi, '')
    .replace(/\bafter\b/gi, '')
    .replace(/\bfrom\b/gi, '');
  return normalizePhrase(withoutPeriods).split(' ').slice(0, 8).join(' ');
}

function side(entityType, entityId, label, detail, clauseNumber = null) {
  return { entityType, entityId, label, detail, clauseNumber };
}

function draft(rule, fields) {
  return {
    ruleId: rule.id,
    ruleLabel: rule.label,
    inconsistencyType: fields.inconsistencyType ?? rule.inconsistencyType,
    why: rule.why,
    title: fields.title,
    severity: fields.severity ?? rule.severity,
    detail: fields.detail,
    clauseIds: (fields.clauseIds ?? []).filter(Boolean),
    entityRefs: (fields.entityRefs ?? []).filter(Boolean),
    evidence: mergeEvidence(fields.evidence ?? []),
    basis: (fields.basis ?? []).filter(Boolean),
    where: fields.where ?? 'no clause recorded',
    comparison: fields.comparison ?? null,
  };
}

function evidenceFor(entity, context) {
  if (!entity) return [];
  const clause = entity.clauseId ? context.clauseById.get(entity.clauseId) : null;
  return mergeEvidence(entity.evidence, clause?.evidence);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** The entity a notice statement came from: the deadline, or the clause itself. */
function clauseOf(statement, context) {
  if (statement.deadlineId) return context.index.get(statement.deadlineId)?.entity ?? null;
  return statement.clauseId ? context.clauseById.get(statement.clauseId) ?? null : null;
}

function clauseNumberOf(entity, context) {
  const clause = entity?.clauseId ? context.clauseById.get(entity.clauseId) : null;
  return clause?.number ?? null;
}

/** Clause numbers present in the document, normalised for comparison. */
function clauseNumberSet(context) {
  const set = new Set();
  for (const clause of context.clauses) {
    for (const value of [clause.number, ...(clause.sectionPath ?? [])]) {
      const normalized = normalizeNumber(value);
      if (normalized) set.add(normalized);
    }
  }
  return set;
}

function normalizeNumber(value) {
  const raw = normalizeText(value).replace(/^(?:clause|section|paragraph|schedule|appendix)\s+/i, '');
  if (!raw) return '';
  return raw.replace(/[^\d.]/g, '').replace(/\.0+$/, '');
}

const RUNNERS = {
  'conflicting-notice-periods': (context) => {
    const rule = RULE_BY_ID.get('conflicting-notice-periods');
    const statements = collectNoticeStatements(context).filter(
      (statement) => statement.exact && statement.days > 0 && statement.days <= 365,
    );
    const groups = new Map();
    for (const statement of statements) {
      if (!groups.has(statement.action)) groups.set(statement.action, []);
      groups.get(statement.action).push(statement);
    }
    const findings = [];
    for (const [action, items] of groups) {
      const days = [...new Set(items.map((item) => item.days))].sort((a, b) => a - b);
      if (days.length < 2) continue;
      // Compare the first statement in document order with the first one that
      // disagrees with it, so the pair is stable and easy to read.
      const first = items[0];
      const other = items.find((item) => item.days !== first.days);
      findings.push(
        draft(rule, {
          title: `${action} notice stated as ${first.days} days and ${other.days} days`,
          detail: `The document states ${first.days} day(s) notice in ${first.label} and ${other.days} day(s) notice in ${other.label} for the same ${action} step.`,
          clauseIds: [first.clauseId, other.clauseId],
          entityRefs: [
            side(first.entityType, first.entityId, first.label, `${first.days} day(s): “${first.phrase}”`, first.clauseNumber),
            side(other.entityType, other.entityId, other.label, `${other.days} day(s): “${other.phrase}”`, other.clauseNumber),
          ],
          evidence: mergeEvidence(evidenceFor(clauseOf(first, context), context), evidenceFor(clauseOf(other, context), context)),
          basis: [
            `Sides compared: ${first.days} day(s) in ${first.label} vs ${other.days} day(s) in ${other.label}.`,
            `Matched phrases: “${first.phrase}” and “${other.phrase}”.`,
            `Grouped because both provisions govern the same step: ${action}.`,
            days.length > 2 ? `Other values stated for this step: ${days.join(', ')} day(s).` : '',
          ],
          where: `${first.label} and ${other.label}`,
          comparison: {
            label: `Notice periods for ${action}`,
            left: `${first.days} day(s) — ${first.label}`,
            right: `${other.days} day(s) — ${other.label}`,
            difference: `${Math.abs(first.days - other.days)} day(s)`,
          },
        }),
      );
    }
    return findings;
  },

  'contradictory-dates': (context) => {
    const rule = RULE_BY_ID.get('contradictory-dates');
    const dated = context.deadlines.filter((deadline) => ISO_DATE.test(String(deadline.date ?? '')));
    const groups = new Map();
    for (const deadline of dated) {
      const key = deadlineEventKey(deadline);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(deadline);
    }
    const findings = [];
    for (const [, items] of groups) {
      const values = [...new Set(items.map((item) => String(item.date).slice(0, 10)))].sort();
      if (values.length < 2) continue;
      const first = items.find((item) => String(item.date).slice(0, 10) === values[0]);
      const last = items.find((item) => String(item.date).slice(0, 10) === values[values.length - 1]);
      findings.push(
        draft(rule, {
          title: `Same event dated ${values[0]} and ${values[values.length - 1]}`,
          detail: `Two deadlines describe the same event but carry different dates: ${values[0]} (${clauseLabel(context.clauseById.get(first.clauseId))}) and ${values[values.length - 1]} (${clauseLabel(context.clauseById.get(last.clauseId))}).`,
          clauseIds: [first.clauseId, last.clauseId],
          entityRefs: [
            side(first.type, first.id, truncate(first.description, 60), `Date: ${values[0]}`, clauseNumberOf(first, context)),
            side(last.type, last.id, truncate(last.description, 60), `Date: ${values[values.length - 1]}`, clauseNumberOf(last, context)),
          ],
          evidence: mergeEvidence(evidenceFor(first, context), evidenceFor(last, context)),
          basis: [
            `Dates compared: ${values[0]} vs ${values[values.length - 1]}.`,
            `Grouped because both deadlines describe: “${deadlineEventKey(first) || 'the same event'}”.`,
            values.length > 2 ? `Other dates recorded for this event: ${values.join(', ')}.` : '',
          ],
          where: `${clauseLabel(context.clauseById.get(first.clauseId))} and ${clauseLabel(context.clauseById.get(last.clauseId))}`,
          comparison: {
            label: 'Dates for the same event',
            left: values[0],
            right: values[values.length - 1],
            difference: 'different calendar dates',
          },
        }),
      );
    }
    return findings;
  },

  'conflicting-terms': (context) => {
    const rule = RULE_BY_ID.get('conflicting-terms');
    const groups = new Map();
    for (const definition of context.definitions) {
      const key = normalizePhrase(definition.term);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(definition);
    }
    const findings = [];
    for (const [, definitions] of groups) {
      const byText = new Map();
      for (const definition of definitions) {
        const text = normalizePhrase(definition.text);
        if (!text || byText.has(text)) continue;
        byText.set(text, definition);
      }
      if (byText.size < 2) continue;
      const entries = [...byText.values()];
      const [first, second] = entries;
      findings.push(
        draft(rule, {
          title: `“${first.term}” is defined twice in different words`,
          detail: `The term “${first.term}” is defined in ${entries.length} places with different wording, so which definition governs is unclear.`,
          clauseIds: [first.clauseId, second.clauseId],
          entityRefs: [
            side(first.type, first.id, `“${first.term}”`, truncate(first.text, 80), clauseNumberOf(first, context)),
            side(second.type, second.id, `“${second.term}”`, truncate(second.text, 80), clauseNumberOf(second, context)),
          ],
          evidence: mergeEvidence(first.evidence, second.evidence),
          basis: [
            `Term compared: “${first.term}”.`,
            `Definition A: “${truncate(first.text, 160)}”`,
            `Definition B: “${truncate(second.text, 160)}”`,
            `Definitions recorded for this term: ${entries.length}.`,
          ],
          where: clauseLabel(context.clauseById.get(first.clauseId) ?? context.clauseById.get(second.clauseId)),
          comparison: {
            label: `Definitions of “${first.term}”`,
            left: truncate(first.text, 70),
            right: truncate(second.text, 70),
            difference: 'different wording',
          },
        }),
      );
    }
    return findings;
  },

  'undefined-term': (context) => {
    const rule = RULE_BY_ID.get('undefined-term');
    const defined = new Set();
    for (const definition of context.definitions) {
      for (const term of [definition.term, ...(definition.aliases ?? [])]) {
        const key = normalizePhrase(term);
        if (key) defined.add(key);
      }
    }
    const partyNames = new Set();
    for (const party of context.parties) {
      for (const name of [party.name, ...(party.aliases ?? [])]) {
        const key = normalizePhrase(name);
        if (key) partyNames.add(key);
      }
    }
    const usages = new Map();
    const record = (entry, clauseId, quoted) => {
      const key = normalizePhrase(entry.term);
      if (!key || key.length < 4) return;
      if (defined.has(key) || partyNames.has(key)) return;
      if (!usages.has(key)) {
        usages.set(key, { term: entry.term, quoted, phrases: [], clauseIds: [], clauseId });
      }
      const usage = usages.get(key);
      usage.quoted = usage.quoted || quoted;
      if (usage.phrases.length < 3) usage.phrases.push(entry.phrase);
      if (clauseId && !usage.clauseIds.includes(clauseId)) usage.clauseIds.push(clauseId);
    };
    for (const clause of context.clauses) {
      const text = clauseText(clause);
      for (const entry of quotedTerms(text)) record(entry, clause.id, true);
      for (const entry of capitalizedTerms(text)) record(entry, clause.id, false);
    }
    for (const obligation of context.obligations) {
      for (const entry of quotedTerms(textForEntity(obligation, context))) {
        record(entry, obligation.clauseId, true);
      }
    }
    const findings = [];
    for (const usage of usages.values()) {
      const strong = usage.quoted;
      if (!strong && usage.clauseIds.length < 2) continue;
      findings.push(
        draft(rule, {
          title: `“${usage.term}” is used as a defined term but not defined`,
          detail: strong
            ? `“${usage.term}” is quoted as a defined term, but no definition entity records its meaning.`
            : `“${usage.term}” is capitalised as a defined term in ${usage.clauseIds.length} clauses, but no definition entity records its meaning.`,
          severity: strong ? 'medium' : 'low',
          clauseIds: usage.clauseIds.slice(0, 4),
          entityRefs: usage.clauseIds.slice(0, 3).map((clauseId) => {
            const clause = context.clauseById.get(clauseId) ?? null;
            return side(ENTITY_TYPES.CLAUSE, clauseId, clauseLabel(clause), `Uses “${usage.term}”`, clause?.number ?? null);
          }),
          evidence: mergeEvidence(...usage.clauseIds.slice(0, 3).map((clauseId) => context.clauseById.get(clauseId)?.evidence)),
          basis: [
            `Term used: “${usage.term}”.`,
            `Appears in ${usage.clauseIds.length} clause(s).`,
            strong ? 'The term is quoted in the document, which marks it as defined.' : 'The term is capitalised in running text in more than one clause.',
            'No definition entity in this document records a meaning for it.',
          ],
          where: usage.clauseIds.slice(0, 3).map((clauseId) => clauseLabel(context.clauseById.get(clauseId))).join(' and ') || 'no clause recorded',
          comparison: null,
        }),
      );
    }
    return findings;
  },

  'duplicate-obligation': (context) => {
    const rule = RULE_BY_ID.get('duplicate-obligation');
    const groups = new Map();
    for (const obligation of context.obligations) {
      const summary = normalizePhrase(obligation.summary);
      if (!summary) continue;
      const key = `${obligation.obligorPartyId ?? 'unassigned'}|${summary}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(obligation);
    }
    const findings = [];
    for (const [, obligations] of groups) {
      const withClause = obligations.filter((obligation) => obligation.clauseId);
      const distinctClauses = new Set(withClause.map((obligation) => obligation.clauseId));
      if (obligations.length < 2 || distinctClauses.size < 2) continue;
      const [first, second] = withClause;
      const party = first.obligorPartyId ? context.partyById.get(first.obligorPartyId) : null;
      findings.push(
        draft(rule, {
          title: `Same duty recorded in ${distinctClauses.size} clauses: ${truncate(first.summary, 60)}`,
          detail: `The duty “${truncate(first.summary, 100)}” is recorded for ${party?.name ?? 'the same party'} in more than one clause.`,
          clauseIds: [...distinctClauses],
          entityRefs: [
            side(first.type, first.id, truncate(first.summary, 60), 'Duplicate duty — first record', clauseNumberOf(first, context)),
            side(second.type, second.id, truncate(second.summary, 60), 'Duplicate duty — repeat record', clauseNumberOf(second, context)),
          ],
          evidence: mergeEvidence(first.evidence, second.evidence),
          basis: [
            `Duties compared: ${obligations.length} records with the same wording and obligor.`,
            `Obligor compared: ${party?.name ?? 'not assigned to a party'}.`,
            `Summary compared: “${truncate(first.summary, 160)}”`,
            'Recorded as a potential inconsistency because the duty may be listed twice.',
          ],
          where: [...distinctClauses]
            .map((clauseId) => clauseLabel(context.clauseById.get(clauseId)))
            .join(' and '),
          comparison: {
            label: `Duties on ${party?.name ?? 'the same party'}`,
            left: clauseLabel(context.clauseById.get([...distinctClauses][0])),
            right: clauseLabel(context.clauseById.get([...distinctClauses][1])),
            difference: 'identical wording',
          },
        }),
      );
    }
    return findings;
  },

  'missing-cross-reference': (context) => {
    const rule = RULE_BY_ID.get('missing-cross-reference');
    const known = clauseNumberSet(context);
    const seen = new Set();
    const findings = [];
    for (const clause of context.clauses) {
      const candidates = [];
      for (const entry of matchAll(clauseText(clause), /\b(?:clause|section|paragraph|schedule|appendix)\s+\d+(?:\.\d+)*/gi)) {
        candidates.push({ phrase: entry.phrase, number: normalizeNumber(entry.phrase) });
      }
      for (const reference of clause.crossReferences ?? []) {
        if (!reference || typeof reference !== 'object') continue;
        const target = reference.targetClauseId ?? reference.clauseId ?? null;
        const phrase = normalizeText(reference.raw ?? reference.label ?? reference.text ?? 'cross-reference');
        if (target && !context.clauseById.has(target)) {
          candidates.push({ phrase, number: normalizeNumber(phrase), missingTargetId: target });
        } else if (!target) {
          candidates.push({ phrase, number: normalizeNumber(phrase) });
        }
      }
      for (const candidate of candidates) {
        const knownNumber =
          candidate.number && (known.has(candidate.number) || known.has(candidate.number.split('.')[0]));
        if (knownNumber) continue;
        const key = `${clause.id}|${candidate.number}|${candidate.missingTargetId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(
          draft(rule, {
            title: `Reference to “${candidate.phrase}” has no matching clause`,
            detail: `${clauseLabel(clause)} refers to “${candidate.phrase}”, but no clause with that number was extracted.`,
            clauseIds: [clause.id],
            entityRefs: [
              side(ENTITY_TYPES.CLAUSE, clause.id, clauseLabel(clause), `Refers to “${candidate.phrase}”`, clause.number ?? null),
            ],
            evidence: clause.evidence,
            basis: [
              `Reference matched: “${candidate.phrase}”.`,
              candidate.number
                ? `Clause numbers present in the document: ${[...known].join(', ') || 'none'}.`
                : 'The reference carries a target id that is not in the document.',
              'The reference could not be resolved to a clause in this document.',
            ],
            where: clauseLabel(clause),
            comparison: null,
          }),
        );
      }
    }
    return findings;
  },

  'orphan-clause-reference': (context) => {
    const rule = RULE_BY_ID.get('orphan-clause-reference');
    const seen = new Set();
    const findings = [];
    for (const [entityId, entry] of context.index) {
      const clauseId = entry.entity?.clauseId;
      if (!clauseId || context.clauseById.has(clauseId)) continue;
      const key = `${entityId}|${clauseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(
        draft(rule, {
          title: `${entry.entityType} links to a clause that is not present`,
          detail: `An entity of type ${entry.entityType} points at clause id “${clauseId}”, which is not part of this document.`,
          clauseIds: [],
          entityRefs: [
            side(entry.entityType, entityId, truncate(entityLabel(entry.entity), 60), `clauseId: ${clauseId}`, null),
          ],
          evidence: entry.entity?.evidence ?? [],
          basis: [
            `Entity type: ${entry.entityType}.`,
            `Linked clause id: “${clauseId}”.`,
            'That id is not present in the clauses extracted for this document.',
          ],
          where: 'whole document',
          comparison: null,
        }),
      );
    }
    for (const relationship of context.relationships) {
      for (const endpoint of [
        { id: relationship.fromId, role: 'from' },
        { id: relationship.toId, role: 'to' },
      ]) {
        if (!endpoint.id || context.index.has(endpoint.id)) continue;
        const key = `${relationship.id}|${endpoint.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(
          draft(rule, {
            title: 'Relationship points at an entity that is not present',
            detail: `A “${relationship.type}” relationship has a missing ${endpoint.role} endpoint (id “${endpoint.id}”).`,
            clauseIds: [],
            entityRefs: [
              side(ENTITY_TYPES.RELATIONSHIP, relationship.id, relationship.type, `missing ${endpoint.role} endpoint: ${endpoint.id}`, null),
            ],
            evidence: relationship.evidence ?? [],
            basis: [
              `Relationship type: ${relationship.type}.`,
              `Missing ${endpoint.role} endpoint id: “${endpoint.id}”.`,
              'The endpoint is not present anywhere in this document model.',
            ],
            where: 'whole document',
            comparison: null,
          }),
        );
      }
    }
    return findings;
  },
};

function entityLabel(entity) {
  return (
    entity?.name ??
    entity?.term ??
    entity?.title ??
    entity?.summary ??
    entity?.description ??
    entity?.id ??
    'entity'
  );
}

/** Context for the inconsistency rules: the shared signal context plus relationships. */
export function buildInconsistencyContext(model) {
  const context = buildSignalContext(model);
  return { ...context, relationships: model?.relationships ?? [] };
}

const DEFAULT_MAX_PER_RULE = 10;
const DEFAULT_MAX_FINDINGS = 60;

function materializeFinding(item, model) {
  const primary = item.entityRefs[0]?.entityId ?? item.clauseIds[0] ?? 'document';
  return {
    id: createEntityId(ENTITY_TYPES.INCONSISTENCY, `${item.ruleId}:${primary}`),
    documentId: model?.documentId ?? null,
    type: ENTITY_TYPES.INCONSISTENCY,
    entityType: ENTITY_TYPES.INCONSISTENCY,
    inconsistencyType: item.inconsistencyType,
    title: item.title,
    severity: item.severity,
    headline: INCONSISTENCY_HEADLINE,
    description: `${INCONSISTENCY_HEADLINE} ${item.detail}`,
    detail: item.detail,
    why: item.why,
    clauseId: item.clauseIds[0] ?? null,
    clauseIds: item.clauseIds,
    entityRefs: item.entityRefs.map((entry) => ({ ...entry })),
    evidence: item.evidence,
    provenance: PROVENANCE.DERIVED,
    confidence: 'high',
    derived: true,
    source: SIGNAL_SOURCES.RULE,
    detection: {
      ruleId: item.ruleId,
      ruleLabel: item.ruleLabel,
      why: item.why,
      where: item.where,
      basis: item.basis,
      comparison: item.comparison,
      ruleVersion: 1,
    },
  };
}

/** Normalises an inconsistency the extraction provider proposed. */
export function normalizeModelInconsistency(entity, model) {
  const clauseIds = [...(entity?.clauseIds ?? []), entity?.clauseId].filter(Boolean);
  return {
    id: entity?.id ?? createEntityId(ENTITY_TYPES.INCONSISTENCY, `model:${entity?.title ?? 'untitled'}`),
    documentId: entity?.documentId ?? model?.documentId ?? null,
    type: ENTITY_TYPES.INCONSISTENCY,
    entityType: ENTITY_TYPES.INCONSISTENCY,
    inconsistencyType: entity?.inconsistencyType ?? 'unknown',
    title: entity?.title ?? 'Untitled finding',
    severity: entity?.severity ?? 'unknown',
    headline: INCONSISTENCY_HEADLINE,
    description: `${INCONSISTENCY_HEADLINE} ${entity?.description ?? ''}`.trim(),
    detail: entity?.description ?? '',
    why: 'The extraction provider proposed this as a possible inconsistency between parts of the document.',
    clauseId: clauseIds[0] ?? null,
    clauseIds,
    entityRefs: (entity?.entityRefs ?? []).map((entry) => ({ ...entry })),
    evidence: entity?.evidence ?? [],
    provenance: entity?.provenance ?? PROVENANCE.AI,
    confidence: entity?.confidence ?? 'unknown',
    derived: false,
    source: SIGNAL_SOURCES.MODEL,
    detection: {
      ruleId: 'model-provided',
      ruleLabel: 'Proposed by the extraction provider',
      why:
        entity?.description ||
        'The provider proposed this comparison; it is not from a comparison rule in this app.',
      where: clauseIds.length ? 'see the cited clauses' : 'whole document',
      basis: [
        `Type recorded as: ${entity?.inconsistencyType ?? 'unknown'}`,
        `Severity recorded as: ${entity?.severity ?? 'unknown'}`,
        'This finding came from the provider, not from a comparison rule in this app.',
      ],
      comparison: null,
      ruleVersion: null,
    },
  };
}

/** Runs every inconsistency rule. Pure and deterministic for a given model. */
export function detectInconsistencies(model, options = {}) {
  if (!model || typeof model !== 'object') return [];
  const { maxPerRule = DEFAULT_MAX_PER_RULE, maxFindings = DEFAULT_MAX_FINDINGS, ruleIds = null } = options;
  const context = buildInconsistencyContext(model);
  const allowed = ruleIds ? new Set(ruleIds) : null;
  const collected = [];
  for (const rule of INCONSISTENCY_RULES) {
    const run = RUNNERS[rule.id];
    if (!run) continue;
    if (allowed && !allowed.has(rule.id)) continue;
    const produced = run(context, options) ?? [];
    collected.push(...sortBySeverity(produced, (item) => item.title).slice(0, maxPerRule));
  }
  const seen = new Set();
  const findings = [];
  for (const item of sortBySeverity(collected, (entry) => `${entry.ruleId}:${entry.title}`)) {
    const key = `${item.ruleId}|${item.entityRefs.map((ref) => ref.entityId).join(',')}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(materializeFinding(item, model));
    if (findings.length >= maxFindings) break;
  }
  return findings;
}

/** Built-in findings plus the ones the provider proposed, with overlap marked. */
export function collectInconsistencies(model, options = {}) {
  const detected = detectInconsistencies(model, options);
  const modelProvided = (model?.inconsistencies ?? []).map((entity) =>
    normalizeModelInconsistency(entity, model),
  );
  const duplicates = [];
  for (const finding of detected) {
    for (const proposed of modelProvided) {
      const shared = finding.clauseIds.find((clauseId) => proposed.clauseIds.includes(clauseId));
      if (
        proposed.inconsistencyType === finding.inconsistencyType &&
        (shared || !proposed.clauseIds.length)
      ) {
        duplicates.push({
          findingId: finding.id,
          proposedId: proposed.id,
          clauseId: shared ?? null,
          reason: `A provider entry and a rule finding share the type “${finding.inconsistencyType}”.`,
        });
      }
    }
  }
  return {
    detected,
    modelProvided,
    all: [...detected, ...modelProvided],
    duplicates,
    counts: {
      detected: detected.length,
      modelProvided: modelProvided.length,
      duplicatePairs: duplicates.length,
      byType: countValues(detected, (finding) => finding.inconsistencyType),
      bySeverity: countValues(detected, (finding) => finding.severity),
      byRule: countValues(detected, (finding) => finding.detection.ruleId),
    },
    headline: INCONSISTENCY_HEADLINE,
    disclaimer: INCONSISTENCY_DISCLAIMER,
  };
}

function countValues(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Findings that mention this entity directly, or through one of its clauses. */
export function inconsistenciesForEntity(entityId, findings, { clauseIds = [] } = {}) {
  if (!entityId && !clauseIds.length) return [];
  const wanted = new Set(clauseIds.filter(Boolean));
  return (findings ?? []).filter((finding) => {
    if ((finding.entityRefs ?? []).some((ref) => ref.entityId === entityId)) return true;
    return (finding.clauseIds ?? []).some((clauseId) => wanted.has(clauseId));
  });
}

/** The catalogue entry for an inconsistency rule id. */
export function inconsistencyRuleById(ruleId) {
  return RULE_BY_ID.get(ruleId) ?? null;
}

