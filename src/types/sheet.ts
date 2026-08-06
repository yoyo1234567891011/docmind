import type { DocumentCategory } from "@/types/document-category";
import type { RiskAssessment } from "@/types/risk";

/**
 * Fiche structurée — mémoire documentaire automatique après chaque analyse.
 * Source unique pour l’UI « fiche » et l’index de recherche IA.
 */
export interface DocumentSheet {
  historyId: string;
  documentId: string;
  /** Nom du document (displayName > title > fileName) */
  name: string;
  /** Type métier libre (ex. « Mise en demeure ») */
  type: string;
  category: DocumentCategory;
  categoryLabel: string;
  summary: string;
  people: string[];
  organizations: string[];
  amounts: string[];
  /** Montants normalisés en euros pour filtres numériques */
  amountValues: number[];
  dates: string[];
  deadlines: string[];
  risks: string[];
  actions: string[];
  /** Mots-clés indexables (recherche IA) */
  keywords: string[];
  /** Niveau de confiance global de la fiche (0..1) */
  confidence: number;
  riskLevel: RiskAssessment["risk_level"];
  riskScore: number;
  fileName: string;
  analyzedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Entrée d’index pour la recherche IA (mots-clés + embedding optionnel).
 */
export interface DocumentSearchIndexEntry {
  historyId: string;
  documentId: string;
  sheet: DocumentSheet;
  /** Texte aplati indexé (fiche complète) */
  searchText: string;
  embedding: number[] | null;
  embeddingModel: string | null;
  indexedAt: string;
}
