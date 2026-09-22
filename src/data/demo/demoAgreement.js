/**
 * Demo document text.
 *
 * FICTIONAL. Parties, amounts and clauses are invented for demonstration. This
 * file contains only text: it is parsed by the real parser and passed through
 * the real extraction pipeline, so demo behaviour matches production behaviour.
 *
 * The fixture in `demoExtraction.js` quotes passages verbatim from this text so
 * evidence verification genuinely passes (or genuinely fails) here too.
 */

export const DEMO_AGREEMENT_FILE_NAME = 'Northwind-Vantage-MSA-demo.txt';

export const DEMO_AGREEMENT_META = Object.freeze({
  title: 'Master Services Agreement — Northwind Analytics / Vantage Cloud Systems',
  documentType: 'agreement',
  effectiveDate: '2025-01-15',
});

export const DEMO_AGREEMENT_TEXT = `MASTER SERVICES AGREEMENT

This Master Services Agreement (the "Agreement") is entered into as of 15 January 2025 (the "Effective Date") between:

(1) Northwind Analytics Ltd, a company registered in England and Wales (the "Customer");
(2) Vantage Cloud Systems Inc., a Delaware corporation (the "Service Provider"); and
(3) Meridian Capital Partners LLP, a limited liability partnership (the "Guarantor").

1. DEFINITIONS AND INTERPRETATION
1.1 "Confidential Information" means all non-public information disclosed by one party to the other party, whether orally or in writing, that is designated as confidential or that a reasonable person would understand to be confidential.
1.2 "Services" means the hosted analytics platform, data ingestion tooling and support services described in Schedule 1.
1.3 "Business Day" means a day other than a Saturday, Sunday or public holiday in England and Wales.

2. SERVICES
2.1 The Service Provider shall provide the Services in accordance with the service levels set out in Schedule 1.
2.2 The Service Provider shall use commercially reasonable efforts to maintain monthly availability of at least 99.5% for the production environment.
2.3 The Service Provider may subcontract any part of the Services, provided that it remains responsible for the acts of its subcontractors.

3. PAYMENT TERMS
3.1 The Customer shall pay each undisputed invoice within thirty (30) days of the invoice date.
3.2 The Service Provider shall issue invoices monthly in arrears for the fees set out in Schedule 2.
3.3 If an undisputed invoice remains unpaid for more than thirty (30) days after its due date, the Service Provider may suspend the Services on ten (10) Business Days' written notice.
3.4 Late amounts shall accrue interest at 1.5% per month from the due date until payment is received.

4. CONFIDENTIALITY
4.1 Each party shall keep the other party's Confidential Information confidential and shall use it solely for the purposes of this Agreement.
4.2 The confidentiality obligations in this clause 4 shall survive for five (5) years following termination of this Agreement.
4.3 The Customer's Confidential Information includes all aggregate usage data and derived analytics produced under this Agreement.

5. LIABILITY
5.1 Neither party's liability for breach of clause 4 shall be limited or excluded.
5.2 Subject to clause 5.1, each party's total liability under this Agreement is limited to the fees paid or payable in the twelve (12) months preceding the claim.

6. REPORTING
6.1 The Service Provider shall deliver a written compliance report within fifteen (15) days after the end of each calendar quarter.

7. TERM AND RENEWAL
7.1 This Agreement commences on the Effective Date and continues until 30 November 2026 (the "Initial Term").
7.2 After the Initial Term this Agreement shall automatically renew for successive periods of twelve (12) months unless either party gives written notice at least ninety (90) days before the end of the then-current term.

8. INVOICE PROCESSING
8.1 The Customer shall settle each undisputed invoice within forty-five (45) days of receipt.

9. TERMINATION
9.1 Either party may terminate this Agreement immediately if the other party commits a material breach that is not cured within thirty (30) days of written notice.
9.2 The Guarantor guarantees payment of all sums due under this Agreement up to a maximum of GBP 250,000.
9.3 Clauses 1, 4, 5, 8 and 9 survive termination of this Agreement.

This document is a fictional sample prepared for ClauseGraph demonstrations and is not legal advice.
`;
