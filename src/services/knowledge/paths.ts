import path from "path";

/** Racine de la base de connaissances (indépendante du code applicatif). */
export function getKnowledgeRoot(): string {
  return path.join(process.cwd(), "knowledge");
}

export function getKnowledgeManifestPath(): string {
  return path.join(getKnowledgeRoot(), "manifest.json");
}
