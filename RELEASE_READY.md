# ClauseTrace — Release Ready Candidate (Final Freeze)

**Release Gate Status: PASSED & CODEBASE FROZEN FOR SUBMISSION**

---

### Release Verification Summary

| Verification Category | Status | Details |
|---|---|---|
| **Release Date** | 2026-09-22 | Final Pre-Submission Freeze |
| **Test Suite** | **PASSED** | **49 test files passed (49), 716 tests passed (716)** |
| **ESLint Audit** | **PASSED** | **0 errors across entire workspace codebase** (`npm run lint`) |
| **Production Build** | **PASSED** | **Vite production bundle compiled cleanly** (`npm run build`) |
| **Smoke Pipeline** | **PASSED** | **3/3 pipeline scenarios verified** (`node scripts/smokePipeline.mjs`) |
| **AI Verification Trace** | **VERIFIED** | Live processing state, 4 evidence verification checks, expandable details, 3 layer badges |
| **Demo Reset** | **VERIFIED** | Browser-local reset workspace modal clears `clausegraph_state_v1` without touching user files |
| **AI Provider Visibility** | **VERIFIED** | Truthful provider label (`Gemini` | `Demo / Mock Provider` | `Not configured`) |
| **Ask Q&A Grounding** | **VERIFIED** | Supported questions return verified citations; unsupported questions safely refuse hallucination |

---

### Architecture & Safety Story

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

---

### Manual Video Walkthrough Checklist (< 4 minutes)

1. **Step 1 — Reset Workspace**: Open application, click **"Reset workspace"** in Sidebar or Status menu, confirm modal, verify app returns to initial state.
2. **Step 2 — Import Document**: Click **"Load demo agreement"** (or import contract file) from Home.
3. **Step 3 — Show AI Processing & Trace**: View live AI Extraction & Verification Trace panel showing verified vs rejected counts and provider state (`Demo / Mock Provider` or `Gemini`).
4. **Step 4 — Verification Summary**: View the 4 verification checks (`✓ Source clause exists`, `✓ Quoted text matches source`, `✓ Character offsets verified`, `✓ Unsupported claims rejected`) and expand **"View extraction details"**.
5. **Step 5 — Relationship Graph**: Open Graph, view progressive disclosure topic chips, switch between Focused and Full view modes, select an obligation node.
6. **Step 6 — Jump to Evidence**: Click **"View source →"** to navigate directly to quoted clause text with character highlight.
7. **Step 7 — Obligations Board**: Open Obligations, apply party responsibility filter ("Only My Obligations" vs "Counterparty").
8. **Step 8 — Obligation Timeline**: View chronological deadlines and schedule signals.
9. **Step 9 — Version Comparison**: Open Compare, inspect side-by-side visual redline and Executive Risk Shift Summary.
10. **Step 10 — Grounded Ask Q&A (Supported)**: Type *"What is the payment deadline for an undisputed invoice?"* — verify grounded answer with verified source citations.
11. **Step 11 — Grounded Ask Q&A (Unsupported)**: Type *"What criminal penalty applies if the customer violates this agreement?"* — verify safe "document does not provide enough information" response without hallucinated citations.
12. **Step 12 — Professional Preparation**: Open Prepare page, review action checklist, and return to workspace.

---

### Known Product Boundaries
1. **Browser-Local Storage**: Persisted state lives in browser `localStorage` under `clausegraph_state_v1`. Use **Reset workspace** to reset cleanly for new demo runs.
2. **Provider Configuration**: The bundled `MockProvider` handles the demo agreement offline; uploading arbitrary new documents requires a proxy-configured AI key (e.g. Gemini).
3. **Text-Based PDF Ingestion**: Scanned image-only PDFs require pre-processing via OCR before parsing.
