/**
 * Demo extraction fixture.
 *
 * This is the "AI proposal" for the demo document: the same JSON shape a real
 * provider is asked to return. It is generated against the parsed document so
 * every evidence quote carries REAL character offsets — which means the demo
 * exercises genuine evidence verification rather than bypassing it.
 *
 * Kept in `src/data/demo/` so demo data never mixes with application logic.
 */

import { DEMO_AGREEMENT_FILE_NAME, DEMO_AGREEMENT_META, DEMO_AGREEMENT_TEXT } from './demoAgreement.js';
import { parseTextContent } from '../../documents/parser.js';

/**
 * Builds the demo document content plus a fixture with real character offsets.
 * Returns { content, payload, problems } — `problems` is empty when every quote
 * in the fixture was found verbatim in the document text.
 */
export function buildDemoExtraction() {
  const content = parseTextContent(DEMO_AGREEMENT_TEXT, {
    fileName: DEMO_AGREEMENT_FILE_NAME,
    fileType: 'txt',
    byteSize: DEMO_AGREEMENT_TEXT.length,
  });

  const problems = [];
  const quote = (snippet, clauseNumber = null) => {
    const start = content.text.indexOf(snippet);
    if (start === -1) {
      problems.push(`Quote not found in demo document: ${snippet.slice(0, 70)}…`);
      return { clauseNumber, sourceText: snippet, page: 1 };
    }
    return {
      clauseNumber,
      page: 1,
      sourceText: snippet,
      startOffset: start,
      endOffset: start + snippet.length,
    };
  };

  const payload = {
    __title: DEMO_AGREEMENT_META.title,
    title: DEMO_AGREEMENT_META.title,
    documentType: DEMO_AGREEMENT_META.documentType,
    effectiveDate: DEMO_AGREEMENT_META.effectiveDate,

    parties: [
      {
        name: 'Northwind Analytics Ltd',
        role: 'customer',
        entityKind: 'company',
        jurisdiction: 'England and Wales',
        aliases: ['Customer'],
        evidence: [
          quote(
            `(1) Northwind Analytics Ltd, a company registered in England and Wales (the "Customer");`,
          ),
        ],
      },
      {
        name: 'Vantage Cloud Systems Inc.',
        role: 'service-provider',
        entityKind: 'company',
        jurisdiction: 'Delaware',
        aliases: ['Service Provider'],
        evidence: [
          quote(
            `(2) Vantage Cloud Systems Inc., a Delaware corporation (the "Service Provider"); and`,
          ),
        ],
      },
      {
        name: 'Meridian Capital Partners LLP',
        role: 'guarantor',
        entityKind: 'partnership',
        jurisdiction: null,
        aliases: ['Guarantor'],
        evidence: [
          quote(
            `(3) Meridian Capital Partners LLP, a limited liability partnership (the "Guarantor").`,
          ),
        ],
      },
    ],

    definitions: [
      {
        term: 'Confidential Information',
        text: 'All non-public information disclosed by one party to the other that is designated as confidential or would reasonably be understood to be confidential.',
        scope: 'document',
        clauseNumber: '1.1',
        evidence: [
          quote(
            `"Confidential Information" means all non-public information disclosed by one party to the other party, whether orally or in writing, that is designated as confidential or that a reasonable person would understand to be confidential.`,
            '1.1',
          ),
        ],
      },
      {
        term: 'Services',
        text: 'The hosted analytics platform, data ingestion tooling and support services described in Schedule 1.',
        scope: 'document',
        clauseNumber: '1.2',
        evidence: [
          quote(
            `"Services" means the hosted analytics platform, data ingestion tooling and support services described in Schedule 1.`,
            '1.2',
          ),
        ],
      },
      {
        term: 'Business Day',
        text: 'A day other than a Saturday, Sunday or public holiday in England and Wales.',
        scope: 'document',
        clauseNumber: '1.3',
        evidence: [
          quote(
            `"Business Day" means a day other than a Saturday, Sunday or public holiday in England and Wales.`,
            '1.3',
          ),
        ],
      },
    ],

    conditions: [
      {
        ref: 'cond-renewal-window',
        summary:
          'The Agreement automatically renews unless a party gives written notice at least 90 days before the end of the current term.',
        conditionType: 'renewal',
        triggerDescription: 'End of the then-current term.',
        clauseNumber: '7.2',
        deadlineRef: 'dl-renewal-notice',
        evidence: [
          quote(
            `After the Initial Term this Agreement shall automatically renew for successive periods of twelve (12) months unless either party gives written notice at least ninety (90) days before the end of the then-current term.`,
            '7.2',
          ),
        ],
      },
      {
        ref: 'cond-material-breach-cure',
        summary:
          'Termination for material breach requires that the breach remains uncured for 30 days after written notice.',
        conditionType: 'condition-precedent',
        triggerDescription: 'Material breach that is not cured within 30 days of written notice.',
        clauseNumber: '9.1',
        deadlineRef: null,
        evidence: [
          quote(
            `Either party may terminate this Agreement immediately if the other party commits a material breach that is not cured within thirty (30) days of written notice.`,
            '9.1',
          ),
        ],
      },
    ],

    deadlines: [
      {
        ref: 'dl-initial-term',
        description: 'End of the Initial Term.',
        date: '2026-11-30',
        dateType: 'fixed',
        clauseNumber: '7.1',
        evidence: [
          quote(`continues until 30 November 2026 (the "Initial Term")`, '7.1'),
        ],
      },
      {
        ref: 'dl-payment',
        description: 'Undisputed invoices are payable within 30 days of the invoice date.',
        dateType: 'relative',
        offsetAmount: 30,
        offsetUnit: 'day',
        anchorEvent: 'invoice date',
        clauseNumber: '3.1',
        evidence: [
          quote(`The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.`, '3.1'),
        ],
      },
      {
        ref: 'dl-renewal-notice',
        description: 'Renewal notice must be given at least 90 days before the end of the current term.',
        dateType: 'relative',
        offsetAmount: 90,
        offsetUnit: 'day',
        anchorEvent: 'end of the then-current term',
        clauseNumber: '7.2',
        evidence: [
          quote(`at least ninety (90) days before the end of the then-current term.`, '7.2'),
        ],
      },
      {
        ref: 'dl-quarterly-report',
        description: 'Compliance report due within 15 days after each calendar quarter end.',
        dateType: 'recurring',
        recurrence: 'quarterly',
        clauseNumber: '6.1',
        evidence: [
          quote(
            `The Service Provider shall deliver a written compliance report within fifteen (15) days after the end of each calendar quarter.`,
            '6.1',
          ),
        ],
      },
      {
        ref: 'dl-confidentiality-survival',
        description: 'Confidentiality obligations survive for five years after termination.',
        dateType: 'relative',
        offsetAmount: 5,
        offsetUnit: 'year',
        anchorEvent: 'termination of this Agreement',
        clauseNumber: '4.2',
        evidence: [
          quote(
            `The confidentiality obligations in this clause 4 shall survive for five (5) years following termination of this Agreement.`,
            '4.2',
          ),
        ],
      },
    ],

    consequences: [
      {
        ref: 'cons-interest',
        description: 'Interest accrues at 1.5% per month on late amounts from the due date.',
        consequenceType: 'interest',
        severity: 'medium',
        clauseNumber: '3.4',
        evidence: [
          quote(
            `Late amounts shall accrue interest at 1.5% per month from the due date until payment is received.`,
            '3.4',
          ),
        ],
      },
      {
        ref: 'cons-suspension',
        description: 'The Service Provider may suspend the Services on 10 Business Days notice.',
        consequenceType: 'suspension',
        severity: 'high',
        clauseNumber: '3.3',
        affectedParty: 'Northwind Analytics Ltd',
        evidence: [
          quote(`the Service Provider may suspend the Services on ten (10) Business Days' written notice.`, '3.3'),
        ],
      },
      {
        ref: 'cons-termination',
        description: 'Either party may terminate immediately for an uncured material breach.',
        consequenceType: 'termination',
        severity: 'critical',
        clauseNumber: '9.1',
        evidence: [
          quote(
            `Either party may terminate this Agreement immediately if the other party commits a material breach that is not cured within thirty (30) days of written notice.`,
            '9.1',
          ),
        ],
      },
    ],

    rights: [
      {
        summary:
          'Suspend the Services if an undisputed invoice remains unpaid for more than 30 days after its due date.',
        holderParty: 'Vantage Cloud Systems Inc.',
        counterpartyParty: 'Northwind Analytics Ltd',
        clauseNumber: '3.3',
        evidence: [
          quote(
            `If an undisputed invoice remains unpaid for more than thirty (30) days after its due date, the Service Provider may suspend the Services on ten (10) Business Days' written notice.`,
            '3.3',
          ),
        ],
      },
      {
        summary: 'Terminate the Agreement for an uncured material breach.',
        holderParty: 'Northwind Analytics Ltd',
        counterpartyParty: 'Vantage Cloud Systems Inc.',
        clauseNumber: '9.1',
        evidence: [
          quote(
            `Either party may terminate this Agreement immediately if the other party commits a material breach that is not cured within thirty (30) days of written notice.`,
            '9.1',
          ),
        ],
      },
    ],

    risks: [
      {
        title: 'Automatic renewal with a 90-day notice window',
        category: 'auto-renewal',
        severity: 'medium',
        explanation:
          'The Agreement renews automatically for 12 months unless notice is given at least 90 days before the end of the term, which is easy to miss.',
        clauseNumber: '7.2',
        evidence: [
          quote(
            `After the Initial Term this Agreement shall automatically renew for successive periods of twelve (12) months unless either party gives written notice at least ninety (90) days before the end of the then-current term.`,
            '7.2',
          ),
        ],
      },
      {
        title: 'Uncapped liability for confidentiality breach',
        category: 'unlimited-liability',
        severity: 'high',
        explanation:
          'Liability for breach of clause 4 is expressly excluded from the overall liability cap in clause 5.2.',
        clauseNumber: '5.1',
        evidence: [
          quote(`Neither party's liability for breach of clause 4 shall be limited or excluded.`, '5.1'),
        ],
      },
      {
        title: 'Confidentiality scope extends to derived analytics',
        category: 'one-sidedness',
        severity: 'low',
        explanation:
          'Clause 4.3 treats all aggregate usage data and derived analytics as Customer Confidential Information.',
        clauseNumber: '4.3',
        evidence: [
          quote(
            `The Customer's Confidential Information includes all aggregate usage data and derived analytics produced under this Agreement.`,
            '4.3',
          ),
        ],
      },
    ],

    inconsistencies: [
      {
        title: 'Conflicting payment periods: 30 days in clause 3.1 and 45 days in clause 8.1',
        inconsistencyType: 'conflicting-terms',
        severity: 'high',
        description:
          'Clause 3.1 requires payment within 30 days of the invoice date, while clause 8.1 allows 45 days from receipt of the same undisputed invoice. Both cannot be satisfied as written.',
        clauseNumbers: ['3.1', '8.1'],
        evidence: [
          quote(
            `The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.`,
            '3.1',
          ),
          quote(
            `The Customer shall settle each undisputed invoice within forty-five (45) days of receipt.`,
            '8.1',
          ),
        ],
      },
    ],

    obligations: [
      {
        summary: 'Provide the Services in accordance with the service levels in Schedule 1.',
        obligorParty: 'Vantage Cloud Systems Inc.',
        obligeeParty: 'Northwind Analytics Ltd',
        clauseNumber: '2.1',
        standard: 'strict',
        informational: false,
        evidence: [
          quote(
            `The Service Provider shall provide the Services in accordance with the service levels set out in Schedule 1.`,
            '2.1',
          ),
        ],
      },
      {
        summary:
          'Use commercially reasonable efforts to maintain monthly availability of at least 99.5%.',
        obligorParty: 'Vantage Cloud Systems Inc.',
        obligeeParty: 'Northwind Analytics Ltd',
        clauseNumber: '2.2',
        standard: 'commercially-reasonable',
        informational: false,
        evidence: [
          quote(
            `The Service Provider shall use commercially reasonable efforts to maintain monthly availability of at least 99.5% for the production environment.`,
            '2.2',
          ),
        ],
      },
      {
        summary: 'Pay each undisputed invoice within 30 days of the invoice date.',
        obligorParty: 'Northwind Analytics Ltd',
        obligeeParty: 'Vantage Cloud Systems Inc.',
        clauseNumber: '3.1',
        standard: 'strict',
        deadlineRef: 'dl-payment',
        consequenceRefs: ['cons-interest'],
        informational: false,
        evidence: [
          quote(
            `The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.`,
            '3.1',
          ),
        ],
      },
      {
        summary: 'Settle each undisputed invoice within 45 days of receipt.',
        obligorParty: 'Northwind Analytics Ltd',
        obligeeParty: 'Vantage Cloud Systems Inc.',
        clauseNumber: '8.1',
        standard: 'strict',
        informational: false,
        evidence: [
          quote(
            `The Customer shall settle each undisputed invoice within forty-five (45) days of receipt.`,
            '8.1',
          ),
        ],
      },
      {
        summary:
          "Keep the other party's Confidential Information confidential and use it solely for the purposes of the Agreement.",
        obligorParty: 'Northwind Analytics Ltd',
        obligeeParty: 'Vantage Cloud Systems Inc.',
        clauseNumber: '4.1',
        standard: 'strict',
        deadlineRef: 'dl-confidentiality-survival',
        informational: false,
        evidence: [
          quote(
            `Each party shall keep the other party's Confidential Information confidential and shall use it solely for the purposes of this Agreement.`,
            '4.1',
          ),
        ],
      },
      {
        summary: 'Deliver a written compliance report within 15 days after each calendar quarter.',
        obligorParty: 'Vantage Cloud Systems Inc.',
        obligeeParty: 'Northwind Analytics Ltd',
        clauseNumber: '6.1',
        standard: 'strict',
        deadlineRef: 'dl-quarterly-report',
        informational: false,
        evidence: [
          quote(
            `The Service Provider shall deliver a written compliance report within fifteen (15) days after the end of each calendar quarter.`,
            '6.1',
          ),
        ],
      },
      {
        summary: 'Guarantee payment of all sums due under the Agreement up to GBP 250,000.',
        obligorParty: 'Meridian Capital Partners LLP',
        obligeeParty: 'Vantage Cloud Systems Inc.',
        clauseNumber: '9.2',
        standard: 'strict',
        informational: false,
        evidence: [
          quote(
            `The Guarantor guarantees payment of all sums due under this Agreement up to a maximum of GBP 250,000.`,
            '9.2',
          ),
        ],
      },
    ],
  };

  return { content, payload, problems };
}
