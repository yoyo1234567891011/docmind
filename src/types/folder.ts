export type FolderId = string;

export interface DocumentFolder {
  id: FolderId;
  name: string;
  description: string;
  system: boolean;
  createdAt: string;
}

export interface CreateFolderInput {
  name: string;
  description?: string;
}

/** Dossier virtuel pour les documents non classés */
export const UNFILED_FOLDER_ID = "non-classes" as const;

export function normalizeStoredFolderId(
  folderId: string | null | undefined,
): string | null {
  if (!folderId || folderId === UNFILED_FOLDER_ID) return null;
  return folderId;
}

export const SYSTEM_FOLDER_DEFINITIONS = [
  {
    id: "personnel",
    name: "Personnel",
    description: "Documents personnels et administratifs du quotidien",
  },
  {
    id: "banque",
    name: "Banque",
    description: "Relevés, crédits, conventions et courriers bancaires",
  },
  {
    id: "assurance",
    name: "Assurance",
    description: "Contrats, avenants et sinistres d’assurance",
  },
  {
    id: "travail",
    name: "Travail",
    description: "Contrats, avenants et courriers liés à l’emploi",
  },
  {
    id: "logement",
    name: "Logement",
    description: "Baux, états des lieux et documents immobiliers",
  },
  {
    id: "sante",
    name: "Santé",
    description: "Mutuelle, remboursements et documents de santé",
  },
  {
    id: "impots",
    name: "Impôts",
    description: "Avis fiscaux, contrôles et échéanciers",
  },
] as const;

export type SystemFolderId = (typeof SYSTEM_FOLDER_DEFINITIONS)[number]["id"];

export interface FolderWithCount extends DocumentFolder {
  documentCount: number;
}

export interface FoldersListResult {
  folders: FolderWithCount[];
  unfiledCount: number;
}
