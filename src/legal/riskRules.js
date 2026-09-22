/**
 * Risk signals.
 *
 * Deterministic, explainable pattern matching over a validated LegalModel. A
 * "signal" is not a score and not advice: it is a statement that the document
 * contains words or structures matching a rule, together with the words that
 * matched (`detection.basis`) and where they appear (`detection.where`).
 *
 * Everything here is pure: no AI, no React, no clock reads unless the caller
 * injects `today`/`effectiveDate` (tests do). The same model always produces the
 * same signals in the same order.
 */

import { ENTITY_TYPES, PROVENANCE, createEntityId, indexEntities } from './schema.js';
import { resolveDeadlineDate } from './obligationEngine.js';
import {
  extractPeriods,
  matchFirst,
  mergeEvidence,
  normalizePhrase,
  normalizeText,
  sortBySeverity,
  truncate,
} from './signalSupport.js';

/** Shown wherever signals are listed. Signals are prompts for a reader, not conclusions. */
export const RISK_SIGNAL_DISCLAIMER =
  'Signals are pattern matches and counts taken from the text of this document. They are prompts for review, not legal advice and not a risk score.';

const NOTICE_CONTEXT = /notice|notify|notification/i;
const TERMINATION_ACT = /may (?:terminate|suspend|cease)|shall be entitled to terminate|right to terminate/i;

/** The catalogue of rules, as plain data, so the UI can explain what it checked. */
export const RISK_RULES = Object.freeze([
  {
    id: 'obligation-without-deadline',
    label: 'Duty with no stated timing',
    category: 'ambiguity',
    severity: 'medium',
    why: 'An obligation is recorded without a deadline and without a triggering condition, so the document does not state when performance is due.',
  },
  {
    id: 'obligation-without-consequence',
    label: 'Duty with no recorded consequence',
    category: 'missing-remedy',
    severity: 'low',
    why: 'No consequence is linked to this obligation, so the model cannot show what the document says follows a failure to perform.',
  },
  {
    id: 'deadline-unresolvable',
    label: 'Deadline that cannot be placed on the calendar',
    category: 'ambiguity',
    severity: 'medium',
    why: 'A deadline exists but has no date, offset or recurrence the engine can resolve, so its timing cannot be checked.',
  },
  {
    id: 'short-notice-period',
    label: 'Notice period shorter than 30 days',
    category: 'short-notice-period',
    severity: 'medium',
    why: 'A notice, renewal or termination provision states a period of fewer than 30 days.',
  },
  {
    id: 'unlimited-liability',
    label: 'Uncapped or unlimited liability wording',
    category: 'unlimited-liability',
    severity: 'high',
    why: 'The clause uses wording that removes or refuses to state a limit on liability.',
  },
  {
    id: 'automatic-renewal',
    label: 'Automatic renewal wording',
    category: 'auto-renewal',
    severity: 'medium',
    why: 'The clause states that the agreement renews automatically or for successive terms.',
  },
  {
    id: 'renewal-without-notice-window',
    label: 'Renewal with no notice deadline recorded',
    category: 'auto-renewal',
    severity: 'medium',
    why: 'A renewal clause exists but no deadline or condition in it records when notice must be given.',
  },
  {
    id: 'vague-standard',
    label: 'Qualified or vague performance standard',
    category: 'ambiguity',
    severity: 'low',
    why: 'The clause qualifies performance (efforts, practicability, promptness, materiality) instead of stating a measurable requirement.',
  },
  {
    id: 'broad-discretion',
    label: 'Decision left to one party’s discretion',
    category: 'broad-discretion',
    severity: 'low',
    why: 'The clause gives a party discretion over a judgement the other party depends on.',
  },
  {
    id: 'one-sided-termination',
    label: 'Termination wording naming only one party',
    category: 'one-sidedness',
    severity: 'medium',
    why: 'Termination wording names a single party, and no right is recorded for the other party in the same clause.',
  },
  {
    id: 'obligation-imbalance',
    label: 'Recorded duties fall on one party',
    category: 'one-sidedness',
    severity: 'low',
    why: 'The obligations recorded in this document are concentrated on one party.',
  },
]);

export const RISK_RULE_IDS = Object.freeze(RISK_RULES.map((rule) => rule.id));

const RULE_BY_ID = new Map(RISK_RULES.map((rule) => [rule.id, rule]));

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** Builds the lookups every rule needs once, so the rules stay small and pure. */
export function buildSignalContext(model) {
  const clauses = model?.clauses ?? [];
  return {
    model,
    index: indexEntities(model),
    clauseById: new Map(clauses.map((clause) => [clause.id, clause])),
    partyById: new Map((model?.parties ?? []).map((party) => [party.id, party])),
    clauseNumberById: new Map(clauses.map((clause) => [clause.id, clause.number ?? null])),
    documents: model?.documents ?? [],
    clauses,
    parties: model?.parties ?? [],
    definitions: model?.definitions ?? [],
    rights: model?.rights ?? [],
    obligations: model?.obligations ?? [],
    conditions: model?.conditions ?? [],
    deadlines: model?.deadlines ?? [],
    consequences: model?.consequences ?? [],
    risks: model?.risks ?? [],
    inconsistencies: model?.inconsistencies ?? [],
  };
}

/** Text a rule may read: the entity's own wording plus the clause it sits in. */
export function textForEntity(entity, context) {
  const own = [
    entity?.summary,
    entity?.description,
    entity?.text,
    entity?.title,
    entity?.explanation,
    entity?.deadlineText,
    entity?.triggerText,
    entity?.consequenceText,
  ]
    .filter(Boolean)
    .join(' \n ');
  const clause = entity?.clauseId ? context.clauseById.get(entity.clauseId) : null;
  return normalizeText(`${own} \n ${clause?.heading ?? ''} ${clause?.text ?? ''}`);
}

/** Clause scope text (heading plus body) for clause-level rules. */
export function clauseText(clause) {
  return normalizeText(`${clause?.heading ?? ''} \n ${clause?.text ?? ''}`);
}

/** Human-readable "where" label for a signal. */
export function clauseLabel(clause) {
  if (!clause) return 'no clause recorded';
  const heading = clause.heading ? ` (${clause.heading})` : '';
  return clause.number ? `Clause ${clause.number}${heading}` : `unnumbered clause${heading}`;
}

function ref(entity, role) {
  return entity ? { entityId: entity.id, entityType: entity.type ?? null, role } : null;
}

/** Parties whose name or alias appears in the text. */
export function partiesMentioned(text, context) {
  const haystack = ` ${normalizePhrase(text)} `;
  return context.parties.filter((party) =>
    [party.name, ...(party.aliases ?? [])]
      .filter(Boolean)
      .some((name) => {
        const needle = normalizePhrase(name);
        return needle.length > 2 && haystack.includes(` ${needle} `);
      }),
  );
}

function draft(rule, fields) {
  const clause = fields.clauseId ? clauseByIdSafe(fields.clauseId, fields.context) : null;
  return {
    ruleId: rule.id,
    ruleLabel: rule.label,
    why: rule.why,
    title: fields.title,
    severity: fields.severity ?? rule.severity,
    category: fields.category ?? rule.category,
    clauseId: fields.clauseId ?? null,
    entityRefs: (fields.entities ?? []).filter(Boolean),
    evidence: mergeEvidence(fields.evidence ?? []),
    basis: (fields.basis ?? []).filter(Boolean),
    where: fields.where ?? clauseLabel(clause),
    details: fields.details ?? null,
  };
}

function clauseByIdSafe(clauseId, context) {
  return context?.clauseById?.get(clauseId) ?? null;
}

const QUALIFIED_STANDARDS = new Set(['best-efforts', 'reasonable-efforts', 'commercially-reasonable']);

const CLAUSE_PATTERNS = {
  'unlimited-liability': [
    /unlimited liability/i,
    /no limit(?:ation)? (?:of|on|to) liability/i,
    /liability (?:shall|will) not be limited/i,
    /not be limited in (?:amount|any (?:way|respect))/i,
    /without (?:any )?limit(?:ation)? of liability/i,
  ],
  'automatic-renewal': [
    /automatically renew/i,
    /auto-renew/i,
    /renews? (?:automatically|for (?:a )?further|for successive|for additional)/i,
    /successive (?:term|period)s? (?:of|unless)/i,
  ],
  'broad-discretion': [
    /sole (?:and absolute )?discretion/i,
    /at (?:its|their|his|her) (?:sole )?discretion/i,
    /as (?:it|they) (?:sees? fit|deems (?:appropriate|necessary|fit))/i,
    /may determine (?:in its|at its|unilaterally)/i,
  ],
  'vague-standard': [
    /reasonable (?:efforts|endeavours|endeavors)/i,
    /best (?:efforts|endeavours|endeavors)/i,
    /as soon as (?:reasonably )?practicable/i,
    /from time to time/i,
    /materially/i,
  ],
};

const TERMINATION_ACT_PATTERNS = [
  /may (?:terminate|suspend|cease)/i,
  /shall be entitled to terminate/i,
  /right to terminate/i,
];

function clauseMatchesPatterns(clause, patterns) {
  const text = clauseText(clause);
  const match = matchFirst(text, patterns);
  if (!match) return null;
  return {
    match,
    clause,
    basis: [
      `Matched phrase: “${match.phrase}”`,
      `Clause type recorded as: ${clause.clauseType ?? 'unclassified'}`,
      `Clause text: “${truncate(clause.text, 160)}”`,
    ],
    where: clauseLabel(clause),
  };
}

function patternRuleRunner(ruleId) {
  const rule = RULE_BY_ID.get(ruleId);
  const patterns = CLAUSE_PATTERNS[ruleId];
  return (context) =>
    context.clauses
      .map((clause) => clauseMatchesPatterns(clause, patterns))
      .filter(Boolean)
      .map((found) =>
        draft(rule, {
          context,
          title: `${rule.label}: ${truncate(found.match.phrase, 60)}`,
          clauseId: found.clause.id,
          where: found.where,
          entities: [ref(found.clause, 'clause')],
          evidence: found.clause.evidence,
          basis: found.basis,
        }),
      );
}

const RUNNERS = {
  'obligation-without-deadline': (context) => {
    const rule = RULE_BY_ID.get('obligation-without-deadline');
    return context.obligations
      .filter(
        (obligation) =>
          !obligation.informational &&
          !obligation.deadlineId &&
          !obligation.triggerConditionId &&
          obligation.standard !== 'informational',
      )
      .map((obligation) =>
        draft(rule, {
          context,
          title: `No timing stated: ${truncate(obligation.summary, 70)}`,
          clauseId: obligation.clauseId,
          entities: [ref(obligation, 'obligation')],
          evidence: obligation.evidence,
          basis: [
            'Obligation has no deadline and no triggering condition recorded.',
            `Summary: “${truncate(obligation.summary, 160)}”`,
            `Performance standard recorded as: ${obligation.standard ?? 'not stated'}`,
          ],
        }),
      );
  },

  'obligation-without-consequence': (context) => {
    const rule = RULE_BY_ID.get('obligation-without-consequence');
    return context.obligations
      .filter(
        (obligation) =>
          !obligation.informational &&
          obligation.standard !== 'informational' &&
          !(obligation.consequenceIds ?? []).length &&
          !normalizeText(obligation.consequenceText),
      )
      .map((obligation) =>
        draft(rule, {
          context,
          title: `No consequence recorded: ${truncate(obligation.summary, 70)}`,
          clauseId: obligation.clauseId,
          entities: [ref(obligation, 'obligation')],
          evidence: obligation.evidence,
          basis: [
            'No consequence entity is linked to this obligation.',
            `Summary: “${truncate(obligation.summary, 160)}”`,
            'The document may still state a remedy elsewhere; this records that nothing is linked here.',
          ],
        }),
      );
  },

  'deadline-unresolvable': (context, options) => {
    const rule = RULE_BY_ID.get('deadline-unresolvable');
    return context.deadlines
      .map((deadline) => ({
        deadline,
        resolved: resolveDeadlineDate(deadline, {
          today: options.today,
          effectiveDate: options.effectiveDate,
        }),
      }))
      .filter(({ resolved }) => !resolved?.date && resolved?.reason)
      .map(({ deadline, resolved }) =>
        draft(rule, {
          context,
          title: `Timing not resolvable: ${truncate(deadline.description, 70)}`,
          clauseId: deadline.clauseId,
          entities: [ref(deadline, 'deadline')],
          evidence: deadline.evidence,
          basis: [
            `Engine reason: ${resolved.reason}`,
            `Deadline type recorded as: ${deadline.dateType ?? 'not stated'}`,
            `Deadline wording: “${truncate(deadline.description ?? deadline.deadlineText, 160)}”`,
          ],
          details: { reason: resolved.reason, dateType: deadline.dateType ?? null },
        }),
      );
  },

  'short-notice-period': (context, options) => {
    const rule = RULE_BY_ID.get('short-notice-period');
    const threshold = Number.isFinite(options.shortNoticeThresholdDays)
      ? options.shortNoticeThresholdDays
      : 30;
    const findings = [];
    for (const deadline of context.deadlines) {
      const clause = clauseByIdSafe(deadline.clauseId, context);
      const scope = normalizeText(
        `${deadline.description ?? ''} ${deadline.event ?? ''} ${deadline.anchorEvent ?? ''} ${clauseText(clause)}`,
      );
      if (!/notice|notify|notification/i.test(scope)) continue;
      const periods = extractPeriods(scope).filter(
        (period) => period.exact && period.days > 0 && period.days < threshold,
      );
      if (!periods.length) continue;
      const shortest = periods.reduce((min, period) => (period.days < min.days ? period : min), periods[0]);
      findings.push(
        draft(rule, {
          context,
          title: `Notice period of ${shortest.phrase}: ${truncate(deadline.description, 60)}`,
          clauseId: deadline.clauseId,
          entities: [ref(deadline, 'deadline')],
          evidence: deadline.evidence,
          basis: [
            `Matched period: “${shortest.phrase}” (${shortest.days} day(s)).`,
            `Threshold for this rule: ${threshold} days.`,
            'Notice wording found in the deadline or the clause it sits in.',
            `Deadline type recorded as: ${deadline.dateType ?? 'not stated'}`,
          ],
          details: { days: shortest.days, phrase: shortest.phrase, threshold },
        }),
      );
    }
    return findings;
  },

  'unlimited-liability': patternRuleRunner('unlimited-liability'),
  'automatic-renewal': patternRuleRunner('automatic-renewal'),
  'broad-discretion': patternRuleRunner('broad-discretion'),

  'vague-standard': (context) => {
    const rule = RULE_BY_ID.get('vague-standard');
    const findings = [];
    for (const obligation of context.obligations) {
      if (!QUALIFIED_STANDARDS.has(obligation.standard)) continue;
      findings.push(
        draft(rule, {
          context,
          title: `Qualified standard (${obligation.standard}): ${truncate(obligation.summary, 60)}`,
          clauseId: obligation.clauseId,
          entities: [ref(obligation, 'obligation')],
          evidence: obligation.evidence,
          basis: [
            `Performance standard recorded as: ${obligation.standard}`,
            `Summary: “${truncate(obligation.summary, 160)}”`,
            'Qualified standards pass a judgement test rather than a measurable one.',
          ],
          details: { standard: obligation.standard },
        }),
      );
    }
    for (const clause of context.clauses) {
      const found = clauseMatchesPatterns(clause, CLAUSE_PATTERNS['vague-standard']);
      if (!found) continue;
      findings.push(
        draft(rule, {
          context,
          title: `Qualified wording: ${truncate(found.match.phrase, 60)}`,
          clauseId: clause.id,
          where: found.where,
          entities: [ref(clause, 'clause')],
          evidence: clause.evidence,
          basis: found.basis,
        }),
      );
    }
    return findings;
  },

  'one-sided-termination': (context) => {
    const rule = RULE_BY_ID.get('one-sided-termination');
    const findings = [];
    for (const clause of context.clauses) {
      const text = clauseText(clause);
      const act = matchFirst(text, TERMINATION_ACT_PATTERNS);
      if (!act) continue;
      if (!/terminat|suspend|cease/i.test(text)) continue;
      const mentioned = partiesMentioned(text, context);
      if (mentioned.length !== 1) continue;
      const [party] = mentioned;
      const reciprocal = context.rights.some(
        (right) => right.clauseId === clause.id && right.holderPartyId && right.holderPartyId !== party.id,
      );
      if (reciprocal) continue;
      findings.push(
        draft(rule, {
          context,
          title: `Termination wording names only ${party.name}`,
          clauseId: clause.id,
          entities: [ref(clause, 'clause'), ref(party, 'party')],
          evidence: mergeEvidence(clause.evidence, party.evidence),
          basis: [
            `Matched phrase: “${act.phrase}”`,
            `Only ${party.name} is named in this clause.`,
            'No right is recorded for the other party in the same clause.',
            `Clause type recorded as: ${clause.clauseType ?? 'unclassified'}`,
          ],
          details: { partyId: party.id },
        }),
      );
    }
    return findings;
  },

  'renewal-without-notice-window': (context) => {
    const rule = RULE_BY_ID.get('renewal-without-notice-window');
    return context.clauses
      .filter((clause) => clause.clauseType === 'renewal' || /renew/i.test(clause.heading ?? ''))
      .filter(
        (clause) =>
          !context.deadlines.some((deadline) => deadline.clauseId === clause.id) &&
          !context.conditions.some(
            (condition) =>
              condition.clauseId === clause.id &&
              ['renewal', 'termination', 'notice'].includes(condition.conditionType),
          ),
      )
      .map((clause) =>
        draft(rule, {
          context,
          title: `Renewal with no notice deadline: ${clause.heading ?? `Clause ${clause.number}`}`,
          clauseId: clause.id,
          entities: [ref(clause, 'clause')],
          evidence: clause.evidence,
          basis: [
            'No deadline entity is linked to this renewal clause.',
            'No renewal, termination or notice condition is linked to it either.',
            `Clause type recorded as: ${clause.clauseType ?? 'unclassified'}`,
          ],
        }),
      );
  },

  'obligation-imbalance': (context, options) => {
    const rule = RULE_BY_ID.get('obligation-imbalance');
    const floor = Number.isFinite(options.minObligationsForImbalance)
      ? options.minObligationsForImbalance
      : 3;
    const counts = new Map();
    for (const obligation of context.obligations) {
      if (!obligation.obligorPartyId) continue;
      counts.set(obligation.obligorPartyId, (counts.get(obligation.obligorPartyId) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    if (!ranked.length) return [];
    const [topPartyId, topCount] = ranked[0];
    const nextCount = ranked[1]?.[1] ?? 0;
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (total < floor) return [];
    if (nextCount > 0 && topCount < nextCount * 3) return [];
    const party = context.partyById.get(topPartyId) ?? null;
    const label = party?.name ?? topPartyId;
    return [
      draft(rule, {
        context,
        title: `${label} carries ${topCount} of the ${total} recorded duties`,
        clauseId: null,
        where: 'whole document',
        entities: [ref(party, 'party')],
        evidence: party?.evidence ?? [],
        basis: [
          `Obligations recorded for ${label}: ${topCount}.`,
          `Obligations recorded for every other party: ${nextCount}.`,
          `Threshold for this rule: at least ${floor} recorded duties and a 3x concentration on one party.`,
        ],
        details: { topPartyId, topCount, nextCount, total },
      }),
    ];
  },
};

const RULES = RISK_RULES.map((rule) => ({ ...rule, run: RUNNERS[rule.id] ?? null }));

/** Where a signal came from: a deterministic rule, or the extraction provider. */
export const SIGNAL_SOURCES = Object.freeze({ RULE: 'rule', MODEL: 'model' });

const DEFAULT_MAX_SIGNALS = 80;
const DEFAULT_MAX_PER_RULE = 12;

function materializeSignal(draft, model, context) {
  const clause = draft.clauseId ? clauseByIdSafe(draft.clauseId, context) : null;
  const primary = draft.entityRefs[0]?.entityId ?? 'document';
  return {
    id: createEntityId(ENTITY_TYPES.RISK, `${SIGNAL_SOURCES.RULE}:${draft.ruleId}:${primary}`),
    documentId: model?.documentId ?? null,
    type: ENTITY_TYPES.RISK,
    entityType: ENTITY_TYPES.RISK,
    title: draft.title,
    category: draft.category,
    severity: draft.severity,
    explanation: `${draft.why} Found in ${draft.where}.`,
    clauseId: draft.clauseId ?? null,
    clauseNumber: clause?.number ?? null,
    relatedEntityRefs: draft.entityRefs.map(({ entityId, entityType }) => ({ entityId, entityType })),
    evidence: draft.evidence,
    provenance: PROVENANCE.DERIVED,
    confidence: 'high',
    derived: true,
    source: SIGNAL_SOURCES.RULE,
    detection: {
      ruleId: draft.ruleId,
      ruleLabel: draft.ruleLabel,
      why: draft.why,
      where: draft.where,
      basis: draft.basis,
      details: draft.details,
      ruleVersion: 1,
    },
  };
}

/** Normalises a risk the extraction provider proposed into the signal shape. */
export function normalizeModelRisk(risk, model) {
  const clauseList = model?.clauses ?? [];
  const clause = clauseList.find((entry) => entry.id === risk?.clauseId) ?? null;
  const where = clauseLabel(clause);
  return {
    id: risk?.id ?? createEntityId(ENTITY_TYPES.RISK, `model:${risk?.title ?? 'untitled'}`),
    documentId: risk?.documentId ?? model?.documentId ?? null,
    type: ENTITY_TYPES.RISK,
    entityType: ENTITY_TYPES.RISK,
    title: risk?.title ?? 'Untitled finding',
    category: risk?.category ?? 'unknown',
    severity: risk?.severity ?? 'unknown',
    explanation: risk?.explanation ?? '',
    clauseId: risk?.clauseId ?? null,
    clauseNumber: clause?.number ?? null,
    relatedEntityRefs: risk?.relatedEntityRefs ?? [],
    evidence: risk?.evidence ?? [],
    provenance: risk?.provenance ?? PROVENANCE.AI,
    confidence: risk?.confidence ?? 'unknown',
    derived: false,
    source: SIGNAL_SOURCES.MODEL,
    detection: {
      ruleId: 'model-provided',
      ruleLabel: 'Proposed by the extraction provider',
      why:
        risk?.explanation ||
        'The extraction provider proposed this entry; it is not a deterministic rule match.',
      where,
      basis: [
        `Category recorded as: ${risk?.category ?? 'unknown'}`,
        `Severity recorded as: ${risk?.severity ?? 'unknown'}`,
        'This entry came from the provider, not from a pattern rule in this app.',
      ],
      details: null,
      ruleVersion: null,
    },
  };
}

/**
 * Runs every rule over the model and returns signals ordered by severity.
 * Pure and deterministic: identical input and options give identical output.
 */
export function detectRiskSignals(model, options = {}) {
  if (!model || typeof model !== 'object') return [];
  const {
    maxSignals = DEFAULT_MAX_SIGNALS,
    maxPerRule = DEFAULT_MAX_PER_RULE,
    ruleIds = null,
    ...ruleOptions
  } = options;
  const context = buildSignalContext(model);
  const allowed = ruleIds ? new Set(ruleIds) : null;
  const collected = [];

  for (const rule of RULES) {
    if (!rule.run) continue;
    if (allowed && !allowed.has(rule.id)) continue;
    const produced = rule.run(context, ruleOptions) ?? [];
    collected.push(...sortBySeverity(produced, (item) => item.title).slice(0, maxPerRule));
  }

  const seen = new Set();
  const signals = [];
  for (const item of sortBySeverity(collected, (entry) => `${entry.ruleId}:${entry.title}`)) {
    const key = `${item.ruleId}|${item.entityRefs.map((r) => r.entityId).join(',')}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(materializeSignal(item, model, context));
    if (signals.length >= maxSignals) break;
  }
  return signals;
}

/** Counts signals by a key function, for chips and summaries. */
export function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The Signals view needs both halves of the picture:
 *  - `signals`: deterministic rule matches found in this app
 *  - `modelRisks`: entries the extraction provider proposed
 *  - `duplicates`: pairs that describe the same category in the same clause
 */
export function collectRiskSignals(model, options = {}) {
  const signals = detectRiskSignals(model, options);
  const modelRisks = (model?.risks ?? []).map((risk) => normalizeModelRisk(risk, model));
  const duplicates = [];
  for (const signal of signals) {
    for (const risk of modelRisks) {
      if (signal.clauseId && signal.clauseId === risk.clauseId && signal.category === risk.category) {
        duplicates.push({
          signalId: signal.id,
          riskId: risk.id,
          clauseId: signal.clauseId,
          category: signal.category,
          reason: `A provider entry and a rule match share the category “${signal.category}” in the same clause.`,
        });
      }
    }
  }
  return {
    signals,
    modelRisks,
    all: [...signals, ...modelRisks],
    duplicates,
    counts: {
      detected: signals.length,
      modelProvided: modelRisks.length,
      duplicatePairs: duplicates.length,
      byRule: countBy(signals, (signal) => signal.detection.ruleId),
      byCategory: countBy(signals, (signal) => signal.category),
      bySeverity: countBy(signals, (signal) => signal.severity),
    },
    disclaimer: RISK_SIGNAL_DISCLAIMER,
  };
}

/** The catalogue entry for a rule id, so the UI can explain what it checks. */
export function ruleById(ruleId) {
  return RULE_BY_ID.get(ruleId) ?? null;
}

/** Signals whose rule touched this entity (directly, or through its clause). */
export function signalsForEntity(entityId, signals, { includeClauseSignals = true, clauseId = null } = {}) {
  if (!entityId) return [];
  return (signals ?? []).filter((signal) => {
    if ((signal.relatedEntityRefs ?? []).some((entry) => entry.entityId === entityId)) return true;
    return Boolean(includeClauseSignals && clauseId && signal.clauseId === clauseId);
  });
}

/** Groups signals by category, keeping the severity order inside each group. */
export function groupSignalsByCategory(signals) {
  const groups = new Map();
  for (const signal of sortBySeverity(signals ?? [], (item) => item.title)) {
    const category = signal.category ?? 'unknown';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(signal);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, signals: items }));
}

