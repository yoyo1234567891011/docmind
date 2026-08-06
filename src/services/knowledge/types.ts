export type KnowledgeDomainConfig = {
  id: string;
  file: string;
  label: string;
  categories: string[];
  aliases: string[];
  keywords: string[];
};

export type KnowledgeManifest = {
  version: number;
  description?: string;
  alwaysInclude: string[];
  maxInjectChars: number;
  maxFiles: number;
  domains: KnowledgeDomainConfig[];
};

export type KnowledgeDocument = {
  id: string;
  label: string;
  file: string;
  categories: string[];
  aliases: string[];
  keywords: string[];
  body: string;
  /** Sections ## titre → contenu */
  sections: { title: string; content: string }[];
};

export type KnowledgeSelection = {
  documents: KnowledgeDocument[];
  /** Texte prêt à injecter dans un prompt */
  promptBlock: string;
  /** Ids retenus (logs / debug) */
  selectedIds: string[];
  scores: Record<string, number>;
};
