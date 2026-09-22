/**
 * Test fixtures.
 *
 * A small but complete, fully valid legal model plus the parsed document content
 * its evidence points at. Offsets are computed from the text, so evidence
 * verification in tests exercises the real code path.
 */

import {
  ENTITY_TYPES,
  createClause,
  createCondition,
  createConsequence,
  createDeadline,
  createDefinition,
  createDocument,
  createLegalModel,
  createObligation,
  createParty,
  createRelationship,
  createRight,
  createRisk,
} from '../schema.js';

export const TEST_DOCUMENT_ID = 'doc_test_agreement';

export const TEST_CLAUSE_TEXTS = {
  payment:
    '1.1 The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.',
  confidentiality:
    "2.1 The Receiving Party shall keep the Disclosing Party's Confidential Information confidential.",
  term: '3.1 This Agreement continues until 30 June 2027 and renews for twelve (12) months unless notice is given.',
};

export const TEST_DOCUMENT_TEXT = [
  '1. PAYMENT',
  TEST_CLAUSE_TEXTS.payment,
  '2. CONFIDENTIALITY',
  TEST_CLAUSE_TEXTS.confidentiality,
  '3. TERM',
  TEST_CLAUSE_TEXTS.term,
].join('\n');

/** Builds the parsed DocumentContent equivalent of the fixture text. */
export function buildTestContent({ documentId = TEST_DOCUMENT_ID, text = TEST_DOCUMENT_TEXT } = {}) {
  return {
    documentId,
    fileName: 'test-agreement.txt',
    fileType: 'txt',
    pageCount: 1,
    pages: [{ pageNumber: 1, text, charStart: 0, charEnd: text.length }],
    text,
    charCount: text.length,
    warnings: [],
    metadata: { sourceKind: 'text' },
  };
}

/** Evidence entry quoting a passage of the fixture document. */
export function quote(passage, { clauseId = null, line = null, text = TEST_DOCUMENT_TEXT } = {}) {
  const start = text.indexOf(passage);
  if (start < 0) throw new Error(`Test fixture passage not found: ${passage.slice(0, 40)}`);
  return {
    id: `ev_${clauseId ?? 'x'}_${start}`,
    documentId: TEST_DOCUMENT_ID,
    clauseId,
    section: line,
    page: 1,
    sourceText: passage,
    startOffset: start,
    endOffset: start + passage.length,
  };
}

/** A complete model that passes validation. */
export function buildValidModel({ documentId = TEST_DOCUMENT_ID } = {}) {
  const paymentStart = TEST_DOCUMENT_TEXT.indexOf(TEST_CLAUSE_TEXTS.payment);
  const clauses = [
    createClause({
      id: 'cl_payment',
      documentId,
      number: '1.1',
      heading: 'PAYMENT',
      text: TEST_CLAUSE_TEXTS.payment,
      level: 2,
      page: 1,
      startOffset: paymentStart,
      endOffset: paymentStart + TEST_CLAUSE_TEXTS.payment.length,
    }),
    createClause({
      id: 'cl_confidentiality',
      documentId,
      number: '2.1',
      heading: 'CONFIDENTIALITY',
      text: TEST_CLAUSE_TEXTS.confidentiality,
      level: 2,
      page: 1,
    }),
    createClause({
      id: 'cl_term',
      documentId,
      number: '3.1',
      heading: 'TERM',
      text: TEST_CLAUSE_TEXTS.term,
      level: 2,
      page: 1,
    }),
  ];

  const customer = createParty({
    id: 'party_customer',
    documentId,
    name: 'Acme Limited',
    role: 'customer',
    entityKind: 'company',
    evidence: [
      quote('The Customer shall pay each undisputed invoice', { line: '1.1', clauseId: 'cl_payment' }),
    ],
  });
  const supplier = createParty({
    id: 'party_supplier',
    documentId,
    name: 'Beta Services plc',
    role: 'service-provider',
    entityKind: 'company',
    evidence: [quote('The Receiving Party shall keep', { line: '2.1', clauseId: 'cl_confidentiality' })],
  });

  const deadlines = [
    createDeadline({
      id: 'dl_payment',
      documentId,
      description: 'Payment due 30 days after the invoice date.',
      dateType: 'relative',
      offsetAmount: 30,
      offsetUnit: 'day',
      anchorEvent: 'invoice date',
      clauseId: 'cl_payment',
      anchorEntityId: 'obl_payment',
      evidence: [quote(TEST_CLAUSE_TEXTS.payment, { line: '1.1', clauseId: 'cl_payment' })],
    }),
    createDeadline({
      id: 'dl_term_end',
      documentId,
      description: 'End of the initial term.',
      date: '2027-06-30',
      dateType: 'fixed',
      clauseId: 'cl_term',
      evidence: [quote('continues until 30 June 2027', { line: '3.1', clauseId: 'cl_term' })],
    }),
  ];

  const conditions = [
    createCondition({
      id: 'cond_renewal',
      documentId,
      summary: 'Automatic renewal unless notice is given.',
      conditionType: 'renewal',
      clauseId: 'cl_term',
      deadlineId: 'dl_term_end',
      evidence: [
        quote('renews for twelve (12) months unless notice is given', { line: '3.1', clauseId: 'cl_term' }),
      ],
    }),
  ];

  const consequences = [
    createConsequence({
      id: 'cons_interest',
      documentId,
      description: 'Interest accrues on late payments.',
      consequenceType: 'interest',
      severity: 'medium',
      clauseId: 'cl_payment',
      evidence: [quote('thirty (30) days of the invoice date', { line: '1.1', clauseId: 'cl_payment' })],
    }),
  ];

  const obligations = [
    createObligation({
      id: 'obl_payment',
      documentId,
      summary: 'Pay undisputed invoices within 30 days.',
      obligorPartyId: customer.id,
      obligeePartyId: supplier.id,
      clauseId: 'cl_payment',
      standard: 'strict',
      deadlineId: 'dl_payment',
      consequenceIds: ['cons_interest'],
      evidence: [quote(TEST_CLAUSE_TEXTS.payment, { line: '1.1', clauseId: 'cl_payment' })],
    }),
    createObligation({
      id: 'obl_confidentiality',
      documentId,
      summary: 'Keep Confidential Information confidential.',
      obligorPartyId: customer.id,
      obligeePartyId: supplier.id,
      clauseId: 'cl_confidentiality',
      standard: 'strict',
      evidence: [quote(TEST_CLAUSE_TEXTS.confidentiality, { line: '2.1', clauseId: 'cl_confidentiality' })],
    }),
  ];

  const rights = [
    createRight({
      id: 'right_renewal_notice',
      documentId,
      summary: 'Give notice to prevent renewal.',
      holderPartyId: customer.id,
      counterpartyPartyId: supplier.id,
      clauseId: 'cl_term',
      evidence: [quote('unless notice is given', { line: '3.1', clauseId: 'cl_term' })],
    }),
  ];

  const definitions = [
    createDefinition({
      id: 'def_invoice',
      documentId,
      term: 'undisputed invoice',
      text: 'An invoice that the Customer has not disputed.',
      scope: 'document',
      clauseId: 'cl_payment',
      evidence: [quote(TEST_CLAUSE_TEXTS.payment, { line: '1.1', clauseId: 'cl_payment' })],
    }),
  ];

  const risks = [
    createRisk({
      id: 'risk_notice_window',
      documentId,
      title: 'Short renewal notice window',
      category: 'auto-renewal',
      severity: 'medium',
      explanation: 'Renewal happens automatically unless notice is given.',
      clauseId: 'cl_term',
      evidence: [
        quote('renews for twelve (12) months unless notice is given', { line: '3.1', clauseId: 'cl_term' }),
      ],
    }),
  ];

  const document = createDocument({
    id: documentId,
    title: 'Test Agreement',
    documentType: 'agreement',
    effectiveDate: '2026-01-01',
    pageCount: 1,
    partyIds: [customer.id, supplier.id],
    clauseIds: clauses.map((clause) => clause.id),
  });

  const relationships = [
    createRelationship({
      type: 'clause-imposes-obligation',
      fromId: 'cl_payment',
      fromType: ENTITY_TYPES.CLAUSE,
      toId: 'obl_payment',
      toType: ENTITY_TYPES.OBLIGATION,
      documentId,
    }),
  ];

  return createLegalModel({
    documentId,
    documents: [document],
    parties: [customer, supplier],
    clauses,
    definitions,
    rights,
    obligations,
    conditions,
    deadlines,
    consequences,
    risks,
    inconsistencies: [],
    relationships,
    meta: { schemaVersion: 'test' },
  });
}
