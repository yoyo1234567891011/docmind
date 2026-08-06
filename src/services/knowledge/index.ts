/**
 * Moteur de connaissances documentaires / juridiques.
 * Source de vérité : dossier `/knowledge` (Markdown + manifest.json).
 */
export { loadKnowledgeCatalog, clearKnowledgeCache } from "./load";
export { selectKnowledgeForDocument } from "./select";
export { getKnowledgeRoot } from "./paths";
export type {
  KnowledgeDocument,
  KnowledgeManifest,
  KnowledgeSelection,
  KnowledgeDomainConfig,
} from "./types";
