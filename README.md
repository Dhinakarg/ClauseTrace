# ClauseTrace

A GenAI legal document intelligence workspace. It reads a contract and turns it into a **traceable** model: parties, clauses, definitions, rights, obligations, conditions, deadlines, consequences, risks, and inconsistencies — each one anchored to the text that supports it.

> **The Golden Rule**: AI proposes structured facts. Deterministic code decides what is true.

---

## Key Features

1. **AI Extraction & Verification Trace**:
   - Visual pipeline trace component (`AITracePanel`) displaying stage progress, facts verified, and proposals rejected.
   - 4 Evidence verification checks (`✓ Source clause exists`, `✓ Quoted text matches source`, `✓ Character offsets verified`, `✓ Unsupported claims rejected`).
   - Expandable structured breakdown of extracted Parties, Obligations, Deadlines, Rights, and Evidence metrics.
   - Distinct layer badges (`AI extraction`, `Evidence verification`, `Deterministic analysis`).
   - Truthful AI provider visibility (`Gemini` | `Demo / Mock Provider` | `Not configured`).

2. **Browser-Local Demo Reset**:
   - Accessible **Reset workspace** modal (`ResetModal.jsx`) in Sidebar footer and TopBar status area.
   - Clears `clausegraph_state_v1` from `localStorage` without deleting user machine files or unrelated local storage data.

3. **Three-Pane Document Reader**:
   - **Left**: Clause navigator with parser clause skeleton and extracted fact markers.
   - **Center**: Verbatim document text with character offset highlights.
   - **Right**: Extracted intelligence grouped by type with verification status badges.

4. **Interactive Legal Workspace**:
   - **Relationship Graph**: Progressive disclosure topic chips, view mode toggle (Focused vs Full), and 1-click **View source →** clause navigation.
   - **Obligations Board & Timeline**: Schedule signals, due dates, and Party Responsibility Filters (*Only My Obligations* vs *Counterparty Obligations*).
   - **Side-by-Side Version Comparison**: Executive Risk Shift Summary, visual redlines, and graph diffs.
   - **Grounded Ask Q&A**: Evidence-first answers. Supported questions cite verified clauses; unsupported questions safely indicate insufficient information without hallucinating.
   - **Review Preparation**: Four-section review checklist assembled deterministically with no AI in the loop.

---

## Pipeline Architecture

```text
Document
   ↓
AI Extraction (Semantic document understanding)
   ↓
Schema Validation (Structure & type validation)
   ↓
Evidence Verification (Source text validation & character offset checks)
   ↓
Validated Legal Model (Immutable workspace contract model)
   ↓
ClauseGraph (Relationship graph, obligations board, timeline, compare & ask)
```

| Stage | Module | Purpose |
| --- | --- | --- |
| **Upload** | `src/documents/upload.js` | Type, size, and emptiness check before reading. |
| **Parse / Chunk** | `src/documents/parser.js`, `chunker.js` | Normalise pages, segment clauses, create token-budgeted chunks. |
| **Propose Facts** | `src/ai` (Mock, or Gemini via proxy) | Propose JSON candidates with quoted evidence passages. |
| **Verify** | `src/documents/evidence.js` | Match quotes to exact character offsets; drop unverified claims. |
| **Assemble** | `src/ai/extractionService.js` | Resolve clause references, build model, reject invalid relationships. |
| **Validate** | `src/legal/validators.js` | Audit types and enums; report warnings and errors. |
| **Publish** | `src/documents/pipeline.js` | Staged orchestration recording real metrics per stage. |
| **Reason** | `src/legal/*Engine.js` | Graph edges, obligation status, timeline, risk shift summary, review plan. |

---

## Quick Start

### Installation & Development

```bash
npm install
npm run dev        # Launch local dev server (http://localhost:5173)
```

### Verification & Testing

```bash
npm test           # Run Vitest suite (716 tests across 49 files)
npm run lint       # Run ESLint (0 errors)
npm run build      # Build production bundle in dist/
npm run preview    # Preview production build

node scripts/smokePipeline.mjs   # Run end-to-end pipeline smoke test
```

---

## Security & Privacy Model

- **Browser-Local Processing**: All parsing, graph layout, timeline calculations, and evidence verification happen inside your browser.
- **Credential Protection**: No provider secrets or API keys are embedded in frontend source. Production configurations use a server-side proxy URL (`VITE_AI_PROXY_URL`).
- **Prompt Injection Defense**: Instruction-like passages in legal text are detected, neutralised, and surfaced in warnings before processing.
- **Zero Hallucination Display**: Unquoted or unverified claims proposed by AI models are rejected by evidence verification and excluded from the workspace model.

---

## Disclaimer

ClauseTrace reports what document text states and highlights potential risk signals based on verified citations. It does not provide legal advice, determine legal enforceability, or replace professional legal review.
