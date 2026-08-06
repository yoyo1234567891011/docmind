/**
 * Deterministic extraction (no LLM).
 * Implementation lives in `src/services/extraction` — this is the AI-layer façade.
 */
export {
  extractAmounts,
  extractDates,
  pickPrimaryDate,
  extractDeadlines,
  sanitizeDeadlines,
  extractPeople,
  extractOrganizations,
  extractDocumentEntities,
} from "@/services/extraction";
export type { ExtractedEntities } from "@/services/extraction";
