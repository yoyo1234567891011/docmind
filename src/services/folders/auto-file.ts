import type { DocumentCategory, SystemFolderId } from "@/types";

/**
 * Mappe la catégorie IA → dossier système.
 * `null` = laisser en Non classés.
 */
const CATEGORY_TO_FOLDER: Record<DocumentCategory, SystemFolderId | null> = {
  banque: "banque",
  assurance: "assurance",
  impots: "impots",
  bail: "logement",
  "contrat-de-travail": "travail",
  "courrier-administratif": "personnel",
  facture: "personnel",
  contrat: "personnel",
  "conditions-generales": "personnel",
  autre: null,
};

/** Affinage léger via le type / libellé libre de l’analyse. */
function refineFromType(
  typeOrLabel: string | undefined,
  fallback: SystemFolderId | null,
): SystemFolderId | null {
  const text = (typeOrLabel || "").toLowerCase();
  if (!text) return fallback;

  if (
    /mutuelle|sant[eé]|m[eé]dical|hospitalisation|pharmacie/.test(text)
  ) {
    return "sante";
  }
  if (/bail|location|loyer|immobilier|syndic/.test(text)) {
    return "logement";
  }
  if (/salaire|employeur|cdi|cdd|paie|travail/.test(text)) {
    return "travail";
  }
  if (/banque|cr[eé]dit|pr[eê]t|compte courant|iban/.test(text)) {
    return "banque";
  }
  if (/assurance|sinistre|avenant/.test(text)) {
    return "assurance";
  }
  if (/imp[oô]t|fiscal|urssaf|dgfip/.test(text)) {
    return "impots";
  }

  return fallback;
}

export function resolveFolderIdForClassification(input: {
  category: DocumentCategory;
  documentType?: string;
  categoryLabel?: string;
}): SystemFolderId | null {
  const byCategory = CATEGORY_TO_FOLDER[input.category] ?? null;
  return refineFromType(
    `${input.documentType || ""} ${input.categoryLabel || ""}`,
    byCategory,
  );
}
