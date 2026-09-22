import { describe, expect, it } from 'vitest';
import { createDeadline } from '../schema.js';
import {
  OBLIGATION_GROUPS,
  clauseExcerpt,
  clauseLabelFor,
  describeObligationCard,
  filterObligationCards,
  groupIdForStatus,
  groupObligationCards,
  obligationPartyOptions,
  relativeDeadlineExpression,
  buildObligationBoard,
  buildObligationCards,
  buildRightsBoard,
} from '../obligationViews.js';
import { buildValidModel } from './fixtures.js';

const TODAY = new Date('2026-09-19T00:00:00Z');
const options = { today: TODAY };
const model = buildValidModel();

describe('obligationViews: labels and relative wording', () => {
  it('names a clause for a reader', () => {
    expect(clauseLabelFor({ number: '3.1', heading: 'TERM' })).toBe('Clause 3.1 (TERM)');
    expect(clauseLabelFor({ number: null, heading: null })).toBe('unnumbered clause');
    expect(clauseLabelFor(null)).toBeNull();
  });

  it('keeps a relative deadline as the document wrote it', () => {
    const deadline = createDeadline({
      id: 'dl_x',
      documentId: 'doc',
      description: 'Payment window',
      dateType: 'relative',
      offsetAmount: 30,
      offsetUnit: 'day',
      anchorEvent: 'invoice date',
    });
    expect(relativeDeadlineExpression(deadline)).toBe('within 30 day(s) after invoice date');
    expect(
      relativeDeadlineExpression(
        createDeadline({ id: 'dl_y', documentId: 'doc', description: 'x', offsetAmount: 5, offsetUnit: 'business-day' }),
      ),
    ).toContain('an event the document does not date');
    expect(
      relativeDeadlineExpression(
        createDeadline({
          id: 'dl_z',
          documentId: 'doc',
          description: 'x',
          dateType: 'recurring',
          recurrence: 'Monthly',
          anchorDate: '2026-01-01',
        }),
      ),
    ).toBe('recurring monthly from 2026-01-01');
    expect(relativeDeadlineExpression(null)).toBeNull();
  });

  it('maps a status onto the group it belongs to', () => {
    expect(groupIdForStatus('overdue')).toBe('overdue');
    expect(groupIdForStatus('due')).toBe('due-soon');
    expect(groupIdForStatus('something-else')).toBe('unknown');
  });
});

describe('obligationViews: cards', () => {
  const cards = buildObligationCards(model, options);

  it('builds one card per obligation, in document order', () => {
    expect(cards.map((card) => card.id)).toEqual(['obl_payment', 'obl_confidentiality']);
  });

  it('carries the six facts a reader needs, plus the assessment', () => {
    const card = cards[0];
    expect(card.responsibleName).toBe('Acme Limited');
    expect(card.recipientName).toBe('Beta Services plc');
    expect(card.standard).toBe('strict');
    expect(card.deadline.date).toBe('2026-01-31');
    expect(card.deadline.relativeExpression).toBe('within 30 day(s) after invoice date');
    expect(card.consequences).toHaveLength(1);
    expect(card.consequences[0].id).toBe('cons_interest');
    expect(card.clauseLabel).toBe('Clause 1.1 (PAYMENT)');
    expect(card.status).toBe('overdue');
    expect(card.groupId).toBe('overdue');
    expect(card.evidence.length).toBeGreaterThan(0);
  });

  it('says plainly when an obligation has no deadline', () => {
    const card = cards[1];
    expect(card.deadline).toBeNull();
    expect(card.status).toBe('unknown');
    expect(card.groupId).toBe('unknown');
    expect(card.ariaLabel).toContain('Acme Limited must');
  });

  it('writes an accessible description for a card', () => {
    expect(describeObligationCard(cards[0])).toContain('for Beta Services plc');
    expect(describeObligationCard(null)).toBe('');
  });

  it('survives a model that is not a model', () => {
    expect(buildObligationCards(null)).toEqual([]);
  });
});

describe('obligationViews: boards and filters', () => {
  const cards = buildObligationCards(model, options);
  const board = buildObligationBoard(model, options);

  it('groups every card, keeping the most urgent group first', () => {
    const groups = groupObligationCards(cards);
    expect(groups).toHaveLength(OBLIGATION_GROUPS.length);
    expect(groups[0].id).toBe('overdue');
    expect(groups[0].count).toBe(1);
    expect(groups.find((group) => group.id === 'unknown').count).toBe(1);
    expect(groups.map((group) => group.count).reduce((a, b) => a + b, 0)).toBe(cards.length);
  });

  it('summarises the board without hiding the gaps', () => {
    expect(board.counts.total).toBe(2);
    expect(board.counts.byGroup.overdue).toBe(1);
    expect(board.counts.byStatus.unknown).toBe(1);
    expect(board.counts.withDeadline).toBe(1);
    expect(board.counts.withoutDeadline).toBe(1);
    expect(board.counts.withConsequence).toBe(1);
    expect(board.counts.unsourced).toBe(0);
    expect(board.counts.unresolved).toBe(0);
    expect(board.counts.byGroup.unknown).toBe(1);
    expect(board.empty).toBe(false);
    expect(board.disclaimer).toMatch(/kept as written/);
  });

  it('offers party filters taken from the cards themselves', () => {
    expect(board.parties).toEqual([
      { id: 'party_customer', name: 'Acme Limited', count: 2 },
    ]);
    expect(obligationPartyOptions([])).toEqual([]);
  });

  it('filters by group, by party and by text', () => {
    expect(filterObligationCards(cards, { groupId: 'overdue' })).toHaveLength(1);
    expect(filterObligationCards(cards, { partyId: 'party_customer' })).toHaveLength(2);
    expect(filterObligationCards(cards, { partyId: 'nobody' })).toHaveLength(0);
    expect(filterObligationCards(cards, { searchText: 'confidential' })).toHaveLength(1);
    expect(filterObligationCards(cards, { searchText: 'nothing matches' })).toHaveLength(0);
    expect(filterObligationCards(null)).toEqual([]);
  });

  it('describes a clause for the detail header, truncated', () => {
    const excerpt = clauseExcerpt(model, 'cl_payment', { maxLength: 20 });
    expect(excerpt.clauseId).toBe('cl_payment');
    expect(excerpt.clauseLabel).toBe('Clause 1.1 (PAYMENT)');
    expect(excerpt.excerpt.length).toBeLessThanOrEqual(21);
    expect(clauseExcerpt(model, 'cl_missing')).toBeNull();
  });
});

describe('obligationViews: rights board', () => {
  const rightsBoard = buildRightsBoard(model);

  it('reads the same clauses from the holder side', () => {
    expect(rightsBoard.rights).toHaveLength(1);
    const right = rightsBoard.rights[0];
    expect(right.holderName).toBe('Acme Limited');
    expect(right.counterpartyName).toBe('Beta Services plc');
    expect(right.clauseLabel).toBe('Clause 3.1 (TERM)');
    expect(right.ariaLabel).toContain('may');
    expect(right.ariaLabel).toContain('against Beta Services plc');
    expect(right.limitations).toEqual([]);
    expect(Array.isArray(right.relatedObligations)).toBe(true);
  });

  it('counts the gaps in the rights it found', () => {
    expect(rightsBoard.counts.total).toBe(1);
    expect(rightsBoard.counts.withoutCounterparty).toBe(0);
    expect(rightsBoard.counts.limited).toBe(0);
    expect(rightsBoard.counts.withoutClause).toBe(0);
    expect(rightsBoard.empty).toBe(false);
    expect(rightsBoard.disclaimer).toMatch(/same validated facts/);
  });

  it('returns an empty board instead of throwing on junk input', () => {
    const empty = buildRightsBoard(null);
    expect(empty.rights).toEqual([]);
    expect(empty.counts.total).toBe(0);
    expect(empty.empty).toBe(true);
  });
});
