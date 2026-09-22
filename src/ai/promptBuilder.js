/**
 * Prompt builder (compatibility facade).
 *
 * The prompt contract itself lives in `prompts.js`. This module re-exports it so
 * existing imports keep working while there is exactly one definition of the
 * extraction prompt in the codebase.
 */

export {
  CLAUSE_OUTPUT_HINT,
  EVIDENCE_INSTRUCTION,
  EVIDENCE_OUTPUT_HINT,
  EXTRACTION_OUTPUT_HINT,
  EXTRACTION_SCHEMA_VERSION,
  EXTRACTION_SYSTEM_PROMPT,
  PROMPT_IDS,
  STRICT_JSON_INSTRUCTION,
  buildAskPrompt,
  buildClauseIndexBlock,
  buildExtractionPrompt,
  buildRepairPrompt,
  describePromptContract,
} from './prompts.js';
