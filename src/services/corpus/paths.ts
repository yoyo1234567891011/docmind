import path from "path";

/** Catégorie racine découverte par evaluate / test:docs */
export const CORPUS_CATEGORY = "real-anonymized";

export const CORPUS_DIR = path.join(process.cwd(), "corpus");
export const CORPUS_INBOX_DIR = path.join(CORPUS_DIR, "inbox");
export const CORPUS_MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
export const REAL_ANONYMIZED_DIR = path.join(
  process.cwd(),
  "test-documents",
  CORPUS_CATEGORY,
);
