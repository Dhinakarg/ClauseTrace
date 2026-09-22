# ClauseGraph

A GenAI legal document intelligence workspace. It reads a contract and turns it into a
**traceable** model: parties, clauses, definitions, rights, obligations, conditions,
deadlines, consequences, risks and inconsistencies — each one anchored to the text that
supports it.

**Phase 2 adds document ingestion and a three-pane reading workspace.** Phase 1's
deterministic reading aid is unchanged; what is new is that a document can now be uploaded,
parsed, chunked, sent to a provider, verified and published — with a staged progress record
and an extraction report that says what each step actually did.

**Phase 5 adds two evidence-first pages: Ask the document and Review preparation.** Ask
retrieves clauses deterministically, quotes them, and only then asks a provider for a reading
that may cite nothing but those clauses; Review preparation assembles a four-section checklist
with no AI in the path at all. Neither page states a conclusion — see *What the workspace
does*.

The rule from Phase 1 still holds: nothing in the UI is generated prose that cannot be traced
back to a clause.

---

## The one rule everything follows

> **AI proposes structured facts. Deterministic code decides what is true.**

| Stage | Who does it | What it may do |
| --- | --- | --- |
| Upload | `src/documents/upload.js` | Check type, size and emptiness **before** reading a byte. |
| Parse / chunk | `src/documents/parser.js`, `chunker.js` | Normalise pages, split text into typed clauses and token-budgeted chunks. No interpretation. |
| Propose facts | `src/ai` (mock, or Gemini via proxy) | Return JSON candidates with quoted evidence. |
| Verify | `src/documents/evidence.js` | Match each quote to real offsets; **drop anything that cannot be matched**. |
| Assemble | `src/ai/extractionService.js` | Resolve clause ids, build the model, reject invalid relationships. |
| Validate | `src/legal/validators.js` | Report errors/warnings; nothing is silently repaired. |
| Publish | `src/documents/pipeline.js` | Record all seven stages with real metrics and accept only a report that did not fail. |
| Reason | `src/legal/*Engine.js` | Graph edges, obligation status, timeline, checklist. No AI involved. |

A hallucinated citation is not a "risk" to be flagged — it is **discarded**, and the
extraction report states how many were dropped. There is no server component, so the entire
app runs in the browser and a document never leaves it unless a provider proxy is configured.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 706 tests, 47 files
npm run lint       # 0 errors (12 react-refresh warnings, deliberate)
npm run build      # production bundle in dist/
npm run preview    # serve the built bundle

node scripts/smokePipeline.mjs   # prints the stage-by-stage report for the demo,
                                 # a prompt-injection document and an empty file
```

The app opens with no document loaded. Load the bundled demo agreement from the Overview or
Documents page, or drop your own PDF / TXT / Markdown file onto the dropzone. Both paths run
the same pipeline: parse → segment → propose → verify → publish. The demo path uses the local
demo provider, so no network call is made.

---

## Architecture

```
src/
  app/            AppShell, provider, error boundary, navigation model (routes 1:1 with nav)
  pages/          One page per route; pages read state, never fetch
  components/     ui/ (Panel, Badge, Button, PageHeader), legal/ (tables, evidence, outline),
                  workspace/ (SourceViewer, DocumentNavigator, ClauseReader, IntelligencePanel,
                  DocumentBrief, sourceView.js), pipeline/ (PipelineProgress), upload/ (dropzone),
                  ask/ (AskPanels), prepare/ (PreparationSections), compare/ (ClausePairPanel)
  state/          documentStore.js (pure reducer) + selectors.js (all derived data)
  documents/      upload.js -> parser.js (PDF/TXT/MD) -> chunker.js (clauses + chunks) ->
                  pipeline.js (staged orchestration) + stages.js, evidence.js (verification)
  legal/          schema, validators, clauseTypes, graphEngine, obligationEngine, relationships,
                  askEngine (retrieval + citation validation), reviewChecklist (prep plan),
                  graphLayout
  ai/             config, provider (interface + registry), prompts, promptBuilder, promptSafety,
                  responseParser, extractionService, askService (grounded ask),
                  providers/{mockProvider, geminiProvider}
  data/demo/      Synthetic agreement + extraction fixture, keyed by parsed document id
  security/       limits.js (sizes, control characters, truncation), secrets.js (credential detection)
scripts/          smokePipeline.mjs — end-to-end pipeline report without a browser
```

**State**: one `useReducer` store. Every mutation is an action, `documentStoreReducer` is
pure and never mutates the previous state, and pages read derived data through
`selectors.js` so coverage, gaps, timelines and graph views are computed in one place.

**Routes** (`/`, `/documents`, `/workspace/:documentId` plus `/graph`, `/timeline`,
`/compare`, `/ask`, `/prepare`) come from `src/app/navigation.js`, which also produces
breadcrumbs and page headers — a route cannot exist without navigation, or vice versa.
Workspace links resolve against the in-memory store and render an honest "this document is
not loaded" state instead of redirecting silently.

### What the workspace does

The workspace has two views over the same document, and both are reachable by URL.

**Reading view (default)** — the three panes described in Phase 2:

- **Left — clause navigator.** The parser's clause skeleton with the extracted-fact count per
  clause, search, type filters and a "has extracted facts" filter. The numbers come from
  deterministic code, not the model's self-assessment.
- **Centre — the document's own text.** Paragraph blocks with the selected clause and its
  citations highlighted at the exact character offsets the verifier matched. Nothing is
  paraphrased, and "Show the whole document" clears the focus.
- **Right — extracted intelligence.** The facts that cite the current selection, grouped by
  type, each with its citations and their verification status. A citation that failed
  verification is labelled (`unverified`, `quote not found`, `range mismatch`) rather than
  hidden, and a clause with no facts says so — that is a real finding.

Selection lives in `?clause=…&fact=…&view=…`, so a specific clause or fact can be linked or
reloaded.

**Brief view** (`?view=brief`) — the Phase 1 panels:

- **Document brief** — parties, clause outline, obligations, findings, verified-citation coverage.
- **Relationship graph** — deterministically derived edges (clause → obligation → party, deadline, risk). Broken edges are counted, never drawn.
- **Obligation timeline** — dates resolved from explicit dates, offsets ("30 days after …") and recurrences. Anything unresolvable is listed as undated instead of guessed.
- **Version comparison** — two versions of an agreement read side by side: added, removed and modified clauses, obligations, rights, deadlines, conditions, consequences and relationships, a word-level text diff, the structure the document states, a graph diff, and a deterministic reach for what each change touches. Nothing is ranked.
- **Clause comparison** — two clauses of one document beside each other with the evidence behind each fact.
- **Ask the document** — evidence-first question answering in three layers. Retrieval is
  deterministic term scoring over the extracted clauses (`legal/askEngine.js`): the matched
  clauses are quoted with their own text, each citation is re-checked against its source range
  (`verified`, `unchecked`, `text-mismatch`, `unknown-clause`, `missing-source`) and the answer
  carries a confidence level with its reasons. Only then may a provider add a *reading*
  (`ai/askService.js`), which is shown only when every clause number it cites was supplied to
  it and exists in the document — otherwise the reading is withheld with the reason and the
  extractive answer stands alone. The question and the returned prose both pass the
  instruction-like-text check, and neither layer states a conclusion.
- **Review preparation** — four sections assembled by `legal/reviewChecklist.js` with no AI in
  the path: questions to ask, facts to gather, clauses to discuss and changes to discuss.
  Items are aggregated per clause, ordered by severity, capped per section, phrased as
  questions or checks rather than verdicts, and every item links back to the clause or
  change it came from. The extraction report stays on the page so a checklist built on a
  partial extraction shows how partial it is, and the plan exports as plain text.

### What the documents page does

- States the accepted types and limits *before* a file is chosen.
- Reports the seven pipeline stages as they happen, with real metrics per stage — no
  percentage that is not derived from something.
- Explains a refused upload (unsupported type, over the size cap, no readable text) instead
  of leaving an empty workspace behind.
- Lists each loaded document with its stage summary and lets a document be re-analyzed or
  removed.

### The staged pipeline

| Stage | Evidence it produces |
| --- | --- |
| Document received | name, size, detected type |
| Text extracted | page count, characters, words, warnings |
| Clauses identified | clause count, chunk count, how many characters were attributed to a clause |
| Entities extracted | chunks completed, draft items, repair runs, injection warnings |
| Relationships built | AI edges vs. deterministically derived edges, rejected edges |
| Evidence validated | entities checked / verified / rejected, clauses with facts |
| Workspace ready | accepted or not, facts published, verified count, citations that could not be verified |

A document is published only when the extraction report did not fail — an unparseable
provider response produces an empty workspace, not a confident-looking model.

---

## Security model

A browser bundle is public, so ClauseGraph **never** ships a provider credential.

- Default provider is `mock`: local deterministic data, zero network egress.
- Real providers are reached through `VITE_AI_PROXY_URL`, a server-side endpoint that owns
  the secret. `getAIConfig()` returns only `{ provider, proxyUrl, model, limits }`.
- Document text is untrusted input: `promptSafety.js` detects instruction-like passages,
  neutralises them, and wraps the document in an escaped fence so it cannot break out of
  the data block.
- The same check runs on an Ask question and on the provider's returned prose before either is
  displayed, and instruction-like text is reported rather than hidden.
- An Ask answer may only cite clauses that were selected by deterministic retrieval, quoted in
  the prompt, and present in the model; a citation that fails any of those three is reported
  and the AI reading is withheld.
- `limits.js` caps file size, request/response size, entity counts and text length, strips
  C0/C1 control characters (preserving `\n`, `\t` and `\f` page breaks) plus zero-width and
  bidi characters, and truncates on word boundaries.
- Logs and diagnostics only ever see `redactSecret()` output.
- A test scans the repository for credential-shaped strings, so a secret cannot land in a
  commit unnoticed.

**Provider trade-off:** with `mock` selected the bundled fixture is the only source of facts —
the default offline provider cannot read an arbitrary document and says so. With `gemini`
selected and a proxy configured, real extraction runs on any uploaded document — but the
proxy itself is out of scope here and must be supplied by the deployment.

---

## Verification

706 tests across 47 files (`npm test`), all passing, plus a successful production build, a
dev-server smoke check and `scripts/smokePipeline.mjs`. The suite deliberately covers the
*failure* paths:

**Phase 1**

- a provider that returns malformed JSON, wrong shapes, or a fully failed run → the report
  says `status: "failed"` and never claims success;
- quoted evidence that does not exist in the document → dropped, counted, reported;
- prompt-injection text embedded in a clause → neutralised and surfaced in the checklist;
- a long numbered clause paragraph (`1.1 "Services" means …`) → still detected as a clause
  heading rather than merged into the previous clause;
- regression: a clause that merely has a risk attached must not be returned as a match for
  an unrelated question;
- `workspaceLinks(null)` must not render dead links.

**Phase 2**

- upload rules: missing file, unsupported type, empty file, oversize file, a PDF with no text
  layer, an unreadable PDF, a missing content object, and a parsed document with no readable
  text → each gets its own code and message, and none of them throw;
- PDF normalization: page offsets, page index, location metadata, and an unreadable buffer;
- chunk metadata: every chunk carries its clause ids, paragraph range and location, and stays
  inside its character budget (a chunk past it is reported as truncated, not silently cut);
- clause typing: heading-scope rules win over keyword hits, and a clause with no heading falls
  back to its number;
- evidence mapping: a fact's clause ids resolve to the clause index, and a reference maps back
  to the source text it quotes;
- pipeline: the seven stages are reported in order, an unparseable provider response is *not*
  accepted, a rejected upload never reaches the store, and stage ids stay in sync with
  `PIPELINE_STAGES`;
- workspace panes render from a real extraction: clause skeleton with fact counts, the
  document's own text with the selected clause highlighted, and citations labelled
  `unverified` / `quote not found` instead of being hidden;
- `sourceView`: block/clause attribution across a heading that shares a paragraph with its
  first clause, highlight merging, filters and progress that stay honest on empty input;
- store: stage snapshots survive a later update that omits them, and a rejected upload creates
  no document entry.

**Phase 5**

- an unanswerable question ("governing law arbitration seat" against a document that says
  nothing about it) → `matched: false`, an honest empty reason, and **no provider call at
  all**;
- a provider that cites a clause the document does not contain, or one it was not given →
  the AI reading is withheld, the reason names the clause numbers, and the extractive answer
  is still returned;
- a provider that cites no clause number, or that returns instruction-like text → the reading
  is withheld and the injection warning is surfaced;
- a clause the parser could not number (heading only, no number) → the reading is shown when the
  provider quotes that heading (matched across case, punctuation and spacing), withheld when it
  answers about the clause without quoting the heading, and the heading of a clause it was *not*
  given does not rescue the answer;
- a provider failure → the extractive answer survives and the failure is reported with its
  code;
- citation validation: a quote that no longer matches its range is `text-mismatch`, a clause
  with no parsed text is `unchecked` (reported, not silently trusted), and a clause number
  quoted *inside* a supplied excerpt is not treated as reaching outside the brief;
- the demo provider answers through the whole pipeline without inventing a citation;
- the preparation plan: items are aggregated per clause, severity-sorted, capped per section,
  the `changes` section appears only when a comparison exists, and the rendered wording
  contains no verdict (`unenforceable`, "you should") — only questions and checks;
- both pages render an honest "no validated extraction" state, and the shell renders the ask
  and prepare routes without leaking an internal error.

Several of these tests found real bugs during development: an obligation status list indexed
like an object, an unguarded `context.clauseIds`, form feeds stripped from legal text, a
fully failed extraction reported as accepted, a risk-only retrieval match, unresolved
sidebar links, import paths that broke the production build, `STAGE_IDS` keyed so that no
stage was ever marked, and a paragraph spanning a heading plus its first clause losing its
clause attribution.

---

## Limitations (deliberate)

1. **No persistence.** Documents live in memory; a reload loses the workspace. Ids come from
   file name + byte size, so re-importing the same file yields the same id.
2. **The offline provider reads one document.** With `mock` selected, only the bundled demo
   agreement has a fixture. Any other document is refused at the final stage with an explicit
   reason and a pointer to provider configuration — never with invented facts.
3. **No legal reasoning.** The tool reports what the text says and what could not be
   established. It does not interpret, advise or rank clauses.
4. **Clause segmentation is heuristic.** Numbered and ALL-CAPS headings plus `(a)` / `(iv)`
   markers are detected; unusual numbering schemes produce coarser clauses.
5. **Text PDFs only.** Pages are read through `pdfjs-dist` text extraction, so a scanned or
   image-only PDF is rejected at the text stage rather than OCR'd.
6. **English-oriented** — date formats, relative offsets and numbering assume English
   contract conventions.
7. **Ask is extractive by design.** The quoted answer is retrieval plus citation checking — no
   summarisation, no cross-clause inference. The provider's *reading* is additive and only
   appears when every clause it cites was supplied to it and exists in the document. A clause the
   parser could not number is cited by its heading instead, matched across case, punctuation and
   spacing; prose with no checkable citation at all is withheld rather than shown. A question
   that retrieval cannot ground is answered "no clause matches those terms" without calling a
   provider at all.
8. **Preparation is a checklist, not an assessment.** Items are questions to ask and facts to
   gather; nothing is ranked, scored or concluded, and the plan is rebuilt from the current
   extraction each time rather than stored.
9. **No server, auth or audit log.** Single-user, single-session tool.

---

## Next phase (recommended)

1. **Server-side extraction proxy** with per-request quotas and caching keyed by document
   fingerprint, so a real provider can be enabled without shipping a key.
2. **Persistence + audit trail** for documents, model versions and review decisions, so a
   checklist item can be closed with a reason.
3. **OCR fallback** for scanned PDFs, behind an explicit user action so a slow, lossy read is
   never silently substituted for a text layer.
4. **Layout-aware reading** (PDF coordinates, tables, defined-term scope) to improve clause
   segmentation on real contracts.
5. **Reviewer workflow**: assign findings, resolve inconsistencies, export the checklist.
6. **Evaluation harness**: a small labelled corpus scoring extraction precision/recall and
   citation verification, so prompt or model changes are measurable rather than assumed.
7. **Ask across documents**: retrieval is per-document today; a workspace-level question would
   need the same citation rules applied across several models — and would be a different
   retrieval problem, not a bigger prompt.
8. **Streaming answers** for long readings, keeping the validation gate in front of the first
   rendered token so an ungrounded sentence can never appear even briefly.
#   C l a u s e T r a c e  
 