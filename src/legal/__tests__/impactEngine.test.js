import { describe, expect, it } from 'vitest';
import { compareModels } from '../compareEngine.js';
import {
  IMPACT_DISCLAIMER,
  IMPACT_KINDS,
  buildDependencyIndex,
  buildImpactForChange,
  buildImpactMap,
  comparisonImpactSummary,
  impactCounts,
  impactsForChange,
  reachFrom,
} from '../impactEngine.js';
import { buildValidModel } from './fixtures.js';

function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

function versionB(mutate = null) {
  const model = clone(buildValidModel());
  if (mutate) mutate(model);
  return model;
}

function findChange(result, scope, label) {
  return (
    result.changes.find((change) => change.scope === scope && `${change.label}`.includes(label)) ?? null
  );
}

function shortenedDeadline() {
  return compareModels(
    buildValidModel(),
    versionB((model) => {
      model.deadlines.find((entry) => entry.id === 'dl_payment').offsetAmount = 15;
    }),
  );
}

describe('impactEngine: dependency index', () => {
  const dependency = buildDependencyIndex(shortenedDeadline());

  it('wires a deadline to the obligation it is anchored to, in both directions', () => {
    expect(dependency.links.get('dl_payment')?.has('obl_payment')).toBe(true);
    expect(dependency.links.get('obl_payment')?.has('dl_payment')).toBe(true);
    expect(dependency.links.get('dl_payment')?.get('obl_payment')).toMatch(/deadline/i);
  });

  it('wires a record to the clause it sits in', () => {
    expect(dependency.links.get('obl_payment')?.has('cl_payment')).toBe(true);
    expect(dependency.links.get('cl_payment')?.get('obl_payment')).toMatch(/clause/i);
  });

  it('indexes every record from both versions', () => {
    expect(dependency.entities.get('cl_payment')).toBeTruthy();
    expect(dependency.entities.get('party_customer')?.entityType).toBe('party');
  });

  it('reaches neighbours breadth-first and stops at the depth limit', () => {
    const oneStep = reachFrom('dl_payment', dependency, 1);
    expect(oneStep.get('obl_payment')?.distance).toBe(1);
    expect(oneStep.get('cl_confidentiality')).toBeUndefined();
  });
});

describe('impactEngine: downstream effects of a changed deadline', () => {
  const comparison = shortenedDeadline();
  const change = findChange(comparison, 'deadlines', 'Payment due');
  const impact = buildImpactForChange(change, buildDependencyIndex(comparison));

  it('starts from the record that changed', () => {
    const own = impact.records.find((record) => record.distance === 0);
    expect(own.entityId).toBe('dl_payment');
    expect(own.statement).toMatch(/is the record that changed/i);
  });

  it('reaches the obligation the deadline is anchored to', () => {
    const obligation = impact.records.find((record) => record.entityId === 'obl_payment');
    expect(obligation).toBeTruthy();
    expect(obligation.kind).toBe(IMPACT_KINDS.OBLIGATION);
    expect(obligation.distance).toBe(1);
    expect(obligation.statement).toMatch(/reaches the obligation/i);
  });

  it('repeats the period movement on the obligation it reaches', () => {
    const obligation = impact.records.find((record) => record.entityId === 'obl_payment');
    expect(obligation.statement).toMatch(/15 day\(s\) instead of 30 day\(s\)/);
  });

  it('summarises the reach without judging it', () => {
    expect(impact.summary).toMatch(/This change reaches/i);
    expect(impact.summary).toMatch(/obligation/i);
    expect(impact.stats.total).toBeGreaterThan(0);
    expect(impact.disclaimer).toBe(IMPACT_DISCLAIMER);
  });

  it('counts only reach beyond the record itself', () => {
    const counts = impactCounts(impact.records);
    expect(counts.total).toBe(impact.records.length - 1);
    expect(counts.byKind[IMPACT_KINDS.OBLIGATION]).toBeGreaterThanOrEqual(1);
    expect(counts.byDistance[1]).toBeGreaterThanOrEqual(1);
  });
});

describe('impactEngine: changes to removed and one-sided records', () => {
  const removal = compareModels(
    buildValidModel(),
    versionB((model) => {
      model.obligations = model.obligations.filter((entry) => entry.id !== 'obl_payment');
      model.clauses = model.clauses.filter((entry) => entry.id !== 'cl_confidentiality');
    }),
  );

  it('still reports reach for a record that only exists in version A', () => {
    const change = findChange(removal, 'obligations', 'Pay undisputed invoices');
    expect(change.changeType).toBe('removed');
    const impact = buildImpactForChange(change, buildDependencyIndex(removal));
    expect(impact.records.some((record) => record.entityId === 'dl_payment')).toBe(true);
    expect(impact.records.some((record) => record.entityId === 'cl_payment')).toBe(true);
  });

  it('returns null for a change id the comparison does not contain', () => {
    expect(impactsForChange(removal, 'does-not-exist')).toBeNull();
  });

  it('says nothing downstream for an unchanged record', () => {
    const unchanged = removal.unchanged.find((change) => change.entityId === 'cl_payment');
    const impact = buildImpactForChange(unchanged, buildDependencyIndex(removal));
    expect(impact.summary).toMatch(/No change was recorded here/i);
  });
});

describe('impactEngine: aggregate view', () => {
  it('maps impact per change and totals it across the comparison', () => {
    const comparison = shortenedDeadline();
    const map = buildImpactMap(comparison);
    expect(map.size).toBe(comparison.changes.length);

    const totals = comparisonImpactSummary(comparison);
    expect(totals.changesWithImpact).toBeGreaterThan(0);
    expect(totals.affectedRecordCount).toBeGreaterThan(0);
    expect(totals.byKindList.length).toBeGreaterThan(0);
    expect(totals.byKindList[0]).toHaveProperty('label');
    expect(totals.disclaimer).toBe(IMPACT_DISCLAIMER);
  });

  it('shows no impact at all when nothing changed', () => {
    const same = compareModels(buildValidModel(), versionB());
    const totals = comparisonImpactSummary(same);
    expect(totals.changesWithImpact).toBe(0);
    expect(totals.affectedRecordCount).toBe(0);
    expect(totals.byKindList).toEqual([]);
  });

  it('describes reach in structural language only', () => {
    const forbidden = /\b(better|worse|harmful|risky|recommend|advise|should|unfavourable)\b/i;
    const map = buildImpactMap(shortenedDeadline());
    const sentences = [];
    for (const impact of map.values()) {
      sentences.push(impact.summary);
      for (const record of impact.records) sentences.push(record.statement);
    }
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) expect(sentence).not.toMatch(forbidden);
  });

  it('produces the same impact totals run to run', () => {
    expect(comparisonImpactSummary(shortenedDeadline())).toEqual(
      comparisonImpactSummary(shortenedDeadline()),
    );
  });
});

