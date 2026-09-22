# ClauseGraph — Submission Readiness Documentation

## 1. Product Overview
ClauseGraph is a browser-only GenAI legal document intelligence workspace. It converts contract text (PDF, TXT, Markdown, or the bundled demo agreement) into an evidence-grounded, traceable legal model featuring parties, clauses, definitions, rights, obligations, conditions, deadlines, consequences, risk signals, inconsistencies, version comparisons, graph visualization, grounded Q&A, and professional review preparation.

## 2. Core Architecture
```
Document Upload / Parser
  ↓
Clause Segmentation & Chunker (Token budgeted)
  ↓
AI Proposal (Facts & Quoted Evidence)
  ↓
Evidence Offset Verification (evidence.js — unmatched quotes dropped)
  ↓
Model Assembly & Validator Engine (schema.js / validators.js)
  ↓
Deterministic Reasoning Engines (Graph, Obligation, Timeline, Risk, Inconsistency, Compare, Impact, Review Checklist)
  ↓
React 18 Three-Pane Workspace & Intelligence Panels
```

## 3. Key Differentiator
> **AI proposes structured facts. Deterministic code decides what is true.**

Unlike standard LLM document summarizers that generate unverified prose, ClauseGraph never treats an unverified LLM output or citation as truth. Every proposed fact must quote verbatim document text that deterministic application code matches to exact character offsets. Unmatched or hallucinated citations are discarded automatically, and extraction report metrics quantify exactly how many were dropped.

## 4. AI Safety
- **Prompt Injection Defense**: Document text is treated as untrusted data (`promptSafety.js`). Instruction-like passages inside contract text are neutralised and fenced so they cannot break out of data blocks or hijack model execution.
- **Citation Whitelisting**: Ask Q&A (`askService.js`) enforces strict clause ID checking. If an LLM response cites unsupplied or nonexistent clause numbers, the AI reading is withheld with an explicit reason while the deterministic extractive answer stands unaffected.
- **Hostile Document Handling**: Hostile documents with prompt injection or fabricated entities are rejected cleanly without polluting workspace state or executing malicious instructions.

## 5. Evidence Grounding
Every legal insight links back to exact character positions in the original document:
- **Graph Nodes**: Node selection navigates directly to supporting source text in `SourceViewer`.
- **Obligations & Rights**: Accompanied by verified source citations and line ranges.
- **Deadlines**: Mapped to exact text quotes and classified as dated or unresolvable.
- **Risk Signals & Inconsistencies**: Highlight exact conflicting clause pairs and supporting quotes.
- **Version Comparisons**: Feature word-level text diffs, clause diffs, and graph reach impact anchored to underlying text changes.
- **Q&A & Review Prep**: Answers quote verbatim text with verified citation badges.

## 6. Deterministic Controls
All core intelligence engines operate deterministically without calling AI:
- `graphEngine.js`: Graph node, edge, and cluster generation.
- `obligationEngine.js`: Obligation status, grouping, and timeline calculations.
- `compareEngine.js` & `impactEngine.js`: Version comparison, graph diff, and reach impact calculation.
- `riskRules.js` & `inconsistencyRules.js`: Static legal risk and contradiction detection.
- `reviewChecklist.js`: 4-section professional preparation checklist generation.

## 7. Security Audit & Findings
- **Zero Secrets**: Repository scan (`secrets.js`) confirmed 0 provider credentials, API keys, or private tokens across code, demo data, git history, or logs.
- **XSS & Rendering Safety**: 0 usages of `dangerouslySetInnerHTML`. React text rendering prevents HTML and script execution from contract text.
- **Input Bounds**: Enforces limits on file size (`LIMITS.MAX_FILE_BYTES`), character length, and strips C0/C1 control characters, zero-width spaces, and bidi overrides.

## 8. Accessibility (a11y)
- **Accessible Graph List Alternative**: `GraphListView.jsx` provides a keyboard-navigable list representation of the legal graph supporting `ArrowUp`/`ArrowDown`/`Enter`/`Space`.
- **Keyboard & Screen Reader Support**: Full keyboard accessibility across tabs, modals, buttons, and navigation drawers with standard ARIA attributes (`aria-label`, `aria-expanded`, `aria-controls`, `aria-current`).
- **Color Independence**: Status tones and badges always combine semantic colors with text labels and icons.

## 9. Test Results
- **Vitest Unit & Integration Suite**: **47 test files passed (47), 706 tests passed (706)**.
- **Smoke Pipeline (`smokePipeline.mjs`)**: Verified 3/3 scenarios:
  1. Demo agreement accepted (32 clauses, 27 verified facts, 91 derived relationships).
  2. Hostile injection document correctly failed and rejected.
  3. Empty document rejected with `upload.no-text`.
- **ESLint**: **0 errors**, 12 expected `react-refresh` warning flags.
- **Production Build (`npm run build`)**: Vite 5 build compiled successfully (`dist/index.html`, assets, PDF worker).

## 10. Performance Decisions
- Centralized memoized derived state in `selectors.js`.
- Gated AI calls: Q&A performs extractive retrieval first; zero LLM calls for ungroundable questions or simple UI navigation.
- Budgeted token chunking in `limits.js` prevents memory exhaustion on large contracts.

## 11. Known Limitations
1. **Session-Only Persistence**: Active documents and checklist progress reside in browser memory for the session.
2. **Provider Key Required for Non-Demo Files**: Offline `MockProvider` supports the demo agreement; custom files require configuring a provider API key (e.g., Gemini).
3. **Text-Based PDF Requirement**: Scanned image PDFs require OCR prior to ingestion.

## 12. Complete Judge Demonstration Sequence (22 Steps)
1. Launch ClauseGraph in browser (`/`).
2. Click "Load demo agreement" (opens `Northwind-Vantage-MSA-demo.txt`).
3. View **Document Brief** tab (inspect metadata & overall score).
4. Inspect extracted **Parties** (Northwind, Vantage Cloud, Meridian Capital).
5. Switch to **Legal Graph** view (`/workspace/doc_.../graph`).
6. Select an obligation node in the graph.
7. Click source citation to navigate to exact quote in **SourceViewer**.
8. Switch to **Timeline** view (`/workspace/doc_.../timeline`).
9. Inspect dated deadlines (30 days, 15 days quarterly report, 90 days renewal notice).
10. Open detected **Inconsistency** signal (30-day payment in 3.1 vs 45-day payment in 8.1).
11. Click navigation links to jump to both conflicting source clauses.
12. Switch to **Version Compare** page (`/workspace/doc_.../compare`).
13. Inspect changed obligations, rights, and word-level diffs between versions.
14. Open **Graph Diff** tab.
15. Inspect **Change Reach Impact** list.
16. Navigate to **Ask the Document** page (`/workspace/doc_.../ask`).
17. Submit a grounded question (e.g. "what notice is required before renewal?").
18. Verify the response quotes Clause 7.2 verbatim with verified citation badge and AI reading.
19. Submit an ungroundable question (e.g. "what is the penalty for patent infringement in Japan?").
20. Verify the system responds honestly with "Nothing in the extracted text answers this" without hallucinating.
21. Navigate to **Review Preparation** page (`/workspace/doc_.../prepare`).
22. Verify the 4-section checklist (Questions, Facts, Clauses, Changes) with grounded clause links and export options.
