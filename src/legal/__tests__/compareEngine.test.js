import { describe, expect, it } from 'vitest';
import {
  CHANGE_TYPES,
  COMPARE_PROBLEM_CODES,
  comparisonCounts,
  compareClauseTexts,
  compareModels,
  compareTexts,
  describeChange,
  diffFields,
  matchEntities,
  periodChange,
  periodNote,
} from '../compareEngine.js';
import { ENTITY_TYPES, createClause } from '../schema.js';
import { buildValidModel, TEST_DOCUMENT_ID } from './fixtures.js';

/** Deep, deterministic copy so each version starts from the same fixture. */
function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

function versionB(mutate = null) {
  const model = clone(buildValidModel());
  if (mutate) mutate(model);
  return model;
}

function changesOf(result, scope) {
  return result.changes.filter((change) => change.scope === scope);
}

function findChange(result, scope, label) {
  return (
    result.changes.find(
      (change) => change.scope === scope && `${change.label}`.includes(label),
    ) ?? null
  );
}

describe('compareModels: identical versions', () => {
  const result = compareModels(buildValidModel(), versionB());

  it('reports the comparison as successful', () => {
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('records no changes and lists the records as unchanged', () => {
    expect(result.changes).toHaveLength(0);
    expect(result.counts.changeCount).toBe(0);
    expect(result.unchanged.length).toBeGreaterThan(0);
    expect(result.counts.unchangedCount).toBe(result.unchanged.length);
  });

  it('says so in the headline without ranking the versions', () => {
    expect(result.summary.headline).toMatch(/no differences are recorded/i);
    expect(result.disclaimer).toMatch(/does not rank the versions/i);
  });

  it('keeps a comparison of the same version stable run to run', () => {
    const again = compareModels(buildValidModel(), versionB());
    expect(again.changes.map((change) => change.id)).toEqual(result.changes.map((change) => change.id));
    expect(again.unchanged.map((change) => change.id)).toEqual(
      result.unchanged.map((change) => change.id),
    );
  });
});

describe('compareModels: added and removed clauses', () => {
  it('classifies a clause that exists in version B only as added', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.clauses.push(
          createClause({
            id: 'cl_liability',
            documentId: TEST_DOCUMENT_ID,
            number: '4.1',
            heading: 'LIABILITY',
            text: '4.1 Liability is limited to the fees paid.',
            level: 2,
          }),
        );
      }),
    );

    const added = findChange(result, 'clauses', 'LIABILITY');
    expect(added).not.toBeNull();
    expect(added.changeType).toBe(CHANGE_TYPES.ADDED);
    expect(added.before).toBeNull();
    expect(added.after.id).toBe('cl_liability');
    expect(added.summary).toMatch(/recorded in version B and not in version A/i);
  });

  it('classifies a clause that exists in version A only as removed', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.clauses = model.clauses.filter((clause) => clause.id !== 'cl_confidentiality');
      }),
    );

    const removed = findChange(result, 'clauses', 'CONFIDENTIALITY');
    expect(removed).not.toBeNull();
    expect(removed.changeType).toBe(CHANGE_TYPES.REMOVED);
    expect(removed.after).toBeNull();
    expect(removed.summary).toMatch(/recorded in version A and not in version B/i);
  });

  it('reports the whole clause as an added passage in the text layer', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.clauses.push(
          createClause({
            id: 'cl_liability',
            documentId: TEST_DOCUMENT_ID,
            number: '4.1',
            heading: 'LIABILITY',
            text: '4.1 Liability is limited to the fees paid.',
            level: 2,
          }),
        );
      }),
    );

    const text = result.text.find((entry) => entry.clauseId === 'cl_liability');
    expect(text).toBeTruthy();
    expect(text.changeType).toBe(CHANGE_TYPES.ADDED);
    expect(text.diff.segments).toHaveLength(1);
    expect(text.diff.segments[0].kind).toBe('added');
  });
});

describe('compareModels: modified records', () => {
  it('reports a re-worded obligation as modified, with the field that moved', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        const obligation = model.obligations.find((entry) => entry.id === 'obl_payment');
        obligation.summary = 'Pay undisputed invoices within 15 days.';
      }),
    );

    const change = findChange(result, 'obligations', 'Pay undisputed invoices');
    expect(change).not.toBeNull();
    expect(change.changeType).toBe(CHANGE_TYPES.MODIFIED);
    expect(change.changedFields).toContain('summary');
    expect(change.summary).toMatch(
      /Summary: Pay undisputed invoices within 30 days\. â†’ Pay undisputed invoices within 15 days\./,
    );
    expect(change.clauseIds).toContain('cl_payment');
  });

  it('keeps the citations from both versions on a modified record', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        const obligation = model.obligations.find((entry) => entry.id === 'obl_payment');
        obligation.summary = 'Pay undisputed invoices within 15 days.';
      }),
    );

    const change = findChange(result, 'obligations', 'Pay undisputed invoices');
    expect(change.evidence.before.length).toBeGreaterThan(0);
    expect(change.evidence.after.length).toBeGreaterThan(0);
    expect(change.evidence.beforeSummary.total).toBe(change.evidence.before.length);
    expect(change.evidence.afterSummary.verified).toBeGreaterThanOrEqual(0);
  });

  it('reports a changed deadline period with the direction of the movement', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        const deadline = model.deadlines.find((entry) => entry.id === 'dl_payment');
        deadline.offsetAmount = 15;
      }),
    );

    const change = findChange(result, 'deadlines', 'Payment due');
    expect(change).not.toBeNull();
    expect(change.changeType).toBe(CHANGE_TYPES.MODIFIED);
    expect(change.period).toBeTruthy();
    expect(change.period.direction).toBe('shortened');
    expect(change.period.beforeDays).toBe(30);
    expect(change.period.afterDays).toBe(15);
    expect(periodNote(change.period)).toMatch(/15 day\(s\) instead of 30 day\(s\)/);
  });

  it('lists untouched records as unchanged with no changed fields', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        const obligation = model.obligations.find((entry) => entry.id === 'obl_confidentiality');
        obligation.summary = 'Keep Confidential Information secret.';
      }),
    );

    const untouched = result.unchanged.find((change) => change.entityId === 'cl_payment');
    expect(untouched).toBeTruthy();
    expect(untouched.changeType).toBe(CHANGE_TYPES.UNCHANGED);
    expect(untouched.changedFields).toEqual([]);
    expect(untouched.fields).toEqual([]);
  });
});

describe('compareModels: relationships', () => {
  it('reports a re-pointed edge as a relationship change, not as an add plus a remove', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.relationships[0].toId = 'obl_confidentiality';
      }),
    );

    const changes = changesOf(result, 'relationships');
    expect(changes).toHaveLength(1);
    const change = changes[0];
    expect(change.changeType).toBe(CHANGE_TYPES.RELATIONSHIP_CHANGED);
    expect(change.beforeDisplay).not.toBe(change.afterDisplay);
    expect(change.afterDisplay).toMatch(/confidential/i);
    expect(change.summary).toMatch(/became/i);
  });

  it('carries the clauses and citations of both endpoints', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.relationships[0].toId = 'obl_confidentiality';
      }),
    );

    const change = changesOf(result, 'relationships')[0];
    expect(change.clauseIds).toContain('cl_payment');
    expect(change.clauseIds).toContain('cl_confidentiality');
    expect(change.evidence.before.length).toBeGreaterThan(0);
  });

  it('leaves an unchanged edge in the unchanged list', () => {
    const result = compareModels(buildValidModel(), versionB());
    expect(result.unchanged.some((change) => change.scope === 'relationships')).toBe(true);
  });
});


describe('compareTexts: word-level text layer', () => {
  it('marks only the words that moved', () => {
    const diff = compareTexts(
      'The Customer shall pay within 30 days of the invoice date.',
      'The Customer shall pay within 15 days of the invoice date.',
    );
    expect(diff.stats.changed).toBe(true);
    expect(diff.stats.removed).toBe(1);
    expect(diff.stats.added).toBe(1);
    expect(diff.segments.some((segment) => segment.kind === 'removed' && segment.text === '30')).toBe(true);
    expect(diff.segments.some((segment) => segment.kind === 'added' && segment.text === '15')).toBe(true);
  });

  it('reports identical passages as unchanged', () => {
    const diff = compareTexts('same wording here', 'same wording here');
    expect(diff.stats.changed).toBe(false);
    expect(diff.segments.every((segment) => segment.kind === 'unchanged')).toBe(true);
  });

  it('never throws on missing text and falls back for very long passages', () => {
    expect(() => compareTexts(null, undefined)).not.toThrow();
    const long = compareTexts('a '.repeat(900), 'b '.repeat(900), { maxTokens: 800 });
    expect(long.truncated).toBe(true);
    expect(long.segments).toHaveLength(2);
  });

  it('produces a text change for a re-worded clause', () => {
    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        const clause = model.clauses.find((entry) => entry.id === 'cl_payment');
        clause.text = clause.text.replace('thirty (30) days', 'fifteen (15) days');
      }),
    );

    const entry = result.text.find((item) => item.clauseId === 'cl_payment');
    expect(entry).toBeTruthy();
    expect(entry.changeType).toBe(CHANGE_TYPES.MODIFIED);
    expect(entry.diff.stats.added).toBeGreaterThan(0);
    expect(compareClauseTexts(buildValidModel(), buildValidModel())).toHaveLength(0);
  });
});

describe('compareModels: structure layer', () => {
  const result = compareModels(
    buildValidModel(),
    versionB((model) => {
      const deadline = model.deadlines.find((entry) => entry.id === 'dl_payment');
      deadline.offsetAmount = 15;
    }),
  );

  it('states the clause timing before and after', () => {
    const entry = result.structure.changes.find((change) => change.kind === 'clause-period');
    expect(entry).toBeTruthy();
    expect(entry.beforeText).toBe('1.1 PAYMENT â†’ 30 days');
    expect(entry.afterText).toBe('1.1 PAYMENT â†’ 15 days');
    expect(entry.changeType).toBe(CHANGE_TYPES.MODIFIED);
    expect(entry.clauseIds).toContain('cl_payment');
  });

  it('does not report structure changes for two identical versions', () => {
    const same = compareModels(buildValidModel(), versionB());
    expect(same.structure.changes).toHaveLength(0);
    expect(same.structure.unchanged.length).toBeGreaterThan(0);
  });
});

describe('matchEntities: pairing records across versions', () => {
  it('pairs a re-numbered, re-keyed record by its natural key', () => {
    const before = [
      createClause({
        id: 'cl_a',
        documentId: TEST_DOCUMENT_ID,
        number: '1.1',
        heading: 'PAYMENT',
        text: 'Payment terms.',
        level: 2,
      }),
    ];
    const after = [
      createClause({
        id: 'cl_b',
        documentId: TEST_DOCUMENT_ID,
        number: '1.2',
        heading: 'PAYMENT',
        text: 'Payment terms.',
        level: 2,
      }),
    ];

    const matched = matchEntities(before, after, { entityType: ENTITY_TYPES.CLAUSE });
    expect(matched.pairs).toHaveLength(1);
    expect(matched.pairs[0].matchedBy).toBe('key');
    expect(matched.added).toHaveLength(0);
    expect(matched.removed).toHaveLength(0);
  });

  it('matches an unrelated record with the same id directly', () => {
    const before = [createClause({ id: 'cl_a', documentId: TEST_DOCUMENT_ID, number: '1.1', text: 'One.' })];
    const after = [createClause({ id: 'cl_a', documentId: TEST_DOCUMENT_ID, number: '9.9', text: 'Two.' })];
    const matched = matchEntities(before, after, { entityType: ENTITY_TYPES.CLAUSE });
    expect(matched.pairs[0].matchedBy).toBe('id');
  });
});

describe('diffFields: field-level comparison', () => {
  it('marks every field as changed when only one version has the record', () => {
    const clause = createClause({
      id: 'cl_x',
      documentId: TEST_DOCUMENT_ID,
      number: '1.1',
      heading: 'PAYMENT',
      text: 'Pay within 30 days.',
      level: 2,
    });
    const fields = diffFields(null, clause, { entityType: ENTITY_TYPES.CLAUSE });
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => field.changed)).toBe(true);
    expect(fields.find((field) => field.field === 'text').afterDisplay).toMatch(/30 days/);
  });

  it('treats whitespace-only differences as no change', () => {
    const base = createClause({
      id: 'cl_x',
      documentId: TEST_DOCUMENT_ID,
      number: '1.1',
      heading: 'PAYMENT',
      text: 'Pay within 30 days.',
      level: 2,
    });
    const respaced = { ...base, text: 'Pay   within 30 days. ' };
    const fields = diffFields(base, respaced, { entityType: ENTITY_TYPES.CLAUSE });
    expect(fields.filter((field) => field.changed)).toEqual([]);
  });
});


describe('compareModels: malformed input', () => {
  it('reports a missing version A instead of throwing', () => {
    const result = compareModels(null, buildValidModel());
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toContain(COMPARE_PROBLEM_CODES.NO_VERSION_A);
    expect(result.changes).toEqual([]);
    expect(result.counts.changeCount).toBe(0);
  });

  it('reports a missing version B instead of throwing', () => {
    const result = compareModels(buildValidModel(), undefined);
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toContain(COMPARE_PROBLEM_CODES.NO_VERSION_B);
    expect(result.graph.nodes).toEqual([]);
  });

  it('reports both problems when neither side is a model', () => {
    const result = compareModels('not a model', { clauses: [] });
    expect(result.problems).toHaveLength(2);
    expect(result.versionA).toBeNull();
    expect(result.summary.headline).toMatch(/no differences/i);
    expect(result.disclaimer).toBeTruthy();
  });

  it('never throws on a comparison of two empty but well-formed models', () => {
    const empty = versionB((model) => {
      for (const key of Object.keys(model)) if (Array.isArray(model[key])) model[key] = [];
    });
    const result = compareModels(empty, clone(empty));
    expect(result.ok).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.text).toEqual([]);
  });
});

describe('compareModels: structural, non-advisory wording', () => {
  const result = compareModels(
    buildValidModel(),
    versionB((model) => {
      const deadline = model.deadlines.find((entry) => entry.id === 'dl_payment');
      deadline.offsetAmount = 15;
      const obligation = model.obligations.find((entry) => entry.id === 'obl_confidentiality');
      obligation.summary = 'Keep Confidential Information secret.';
      model.relationships[0].toId = 'obl_confidentiality';
    }),
  );

  it('describes changes without ranking the versions', () => {
    const forbidden = /\b(better|worse|best|worst|harmful|risky|recommend|advise|should|preferable)\b/i;
    const sentences = [
      ...result.changes.map((change) => change.summary),
      ...result.unchanged.map((change) => describeChange(change)),
      ...result.structure.changes.map((change) => `${change.beforeText} ${change.afterText}`),
    ];
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) expect(sentence).not.toMatch(forbidden);
  });

  it('counts the changes per scope for the summary strip', () => {
    const totals = comparisonCounts(result);
    expect(totals.scopeList).toHaveLength(9);
    expect(totals.scopeList.map((entry) => entry.scope)).toContain('relationships');
    expect(totals.byChangeType[CHANGE_TYPES.MODIFIED]).toBeGreaterThan(0);
    expect(totals.byChangeType[CHANGE_TYPES.RELATIONSHIP_CHANGED]).toBe(1);
    expect(totals.textChanges).toBe(0);
    expect(totals.structureChanges).toBeGreaterThan(0);
    expect(totals.graphNodes.total).toBeGreaterThan(0);
  });

  it('reports the compared versions with their record counts', () => {
    expect(result.versionA.label).toBe('Version A');
    expect(result.versionB.label).toBe('Version B');
    expect(result.versionA.title).toBe('Test Agreement');
    expect(result.versionA.entityCount).toBeGreaterThan(0);
  });
});

describe('compareModels: evidence preservation', () => {
  const result = compareModels(
    buildValidModel(),
    versionB((model) => {
      model.clauses = model.clauses.filter((clause) => clause.id !== 'cl_confidentiality');
      model.clauses.push(
        createClause({
          id: 'cl_audit',
          documentId: TEST_DOCUMENT_ID,
          number: '5.1',
          heading: 'AUDIT',
          text: '5.1 The Customer may audit once per year.',
          level: 2,
          evidence: [
            {
              id: 'ev_audit',
              documentId: TEST_DOCUMENT_ID,
              clauseId: 'cl_audit',
              sourceText: 'The Customer may audit once per year.',
              startOffset: 0,
              endOffset: 38,
            },
          ],
        }),
      );
    }),
  );

  it('gives removed records their version A citations', () => {
    const removed = findChange(result, 'clauses', 'CONFIDENTIALITY');
    expect(removed.evidence.before.length).toBeGreaterThan(0);
    expect(removed.evidence.after).toEqual([]);
    expect(removed.evidence.beforeSummary.total).toBe(removed.evidence.before.length);
  });

  it('gives added records their version B citations', () => {
    const added = findChange(result, 'clauses', 'AUDIT');
    expect(added.evidence.before).toEqual([]);
    expect(added.evidence.after).toHaveLength(1);
    expect(added.evidence.after[0].sourceText).toMatch(/audit once per year/i);
  });

  it('always exposes both citation lists as arrays', () => {
    for (const change of [...result.changes, ...result.unchanged]) {
      expect(Array.isArray(change.evidence.before)).toBe(true);
      expect(Array.isArray(change.evidence.after)).toBe(true);
    }
  });
});


describe('periodChange: stated periods in words and numbers', () => {
  it('reports a shorter and a longer stated period', () => {
    const shortened = periodChange(
      { offsetAmount: 1, offsetUnit: 'week' },
      { offsetAmount: 3, offsetUnit: 'day' },
    );
    expect(shortened.direction).toBe('shortened');
    expect(shortened.beforeDays).toBe(7);
    expect(shortened.afterDays).toBe(3);
    expect(shortened.exact).toBe(true);

    const extended = periodChange(
      { offsetAmount: 1, offsetUnit: 'month' },
      { offsetAmount: 2, offsetUnit: 'month' },
    );
    expect(extended.direction).toBe('extended');
    expect(extended.exact).toBe(false);
  });

  it('says nothing when the period reads the same', () => {
    expect(
      periodChange({ offsetAmount: 30, offsetUnit: 'day' }, { offsetAmount: 30, offsetUnit: 'day' }),
    ).toBeNull();
    expect(periodChange({}, {})).toBeNull();
  });

  it('falls back to wording when the period is not a number', () => {
    const changed = periodChange(
      { description: 'Payment due 30 days after the invoice date.' },
      { description: 'Payment due on the last working day of the month.' },
    );
    expect(changed).toBeNull();
  });
});

describe('buildExecutiveRiskShiftSummary: executive summary generation', () => {
  it('generates executive risk shift highlights when obligations or deadlines change', () => {
    const _changes = [
      {
        scope: 'deadlines',
        label: 'Notice window',
        period: { direction: 'shortened', beforeDays: 60, afterDays: 30 },
      },
      {
        scope: 'obligations',
        changeType: CHANGE_TYPES.ADDED,
        label: 'Pay late fee',
      },
    ];

    const result = compareModels(
      buildValidModel(),
      versionB((model) => {
        model.obligations.push({
          id: 'obl_new',
          summary: 'Pay late fee',
          clauseId: 'cl_payment',
        });
      }),
    );

    expect(result.riskShiftSummary).toBeDefined();
    expect(Array.isArray(result.riskShiftSummary)).toBe(true);
    expect(result.riskShiftSummary.length).toBeGreaterThan(0);
  });
});


