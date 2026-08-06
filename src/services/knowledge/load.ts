import { readFile, readdir } from "fs/promises";
import path from "path";

import {
  getKnowledgeManifestPath,
  getKnowledgeRoot,
} from "@/services/knowledge/paths";
import type {
  KnowledgeDocument,
  KnowledgeManifest,
} from "@/services/knowledge/types";

let catalogCache: KnowledgeDocument[] | null = null;
let catalogMtimeKey = "";

function splitSections(body: string): { title: string; content: string }[] {
  const lines = body.split(/\r?\n/);
  const sections: { title: string; content: string }[] = [];
  let currentTitle = "Introduction";
  let buf: string[] = [];

  const flush = () => {
    const content = buf.join("\n").trim();
    if (content) sections.push({ title: currentTitle, content });
    buf = [];
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flush();
      currentTitle = heading[1]!.trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections;
}

async function readManifest(): Promise<KnowledgeManifest> {
  const raw = await readFile(getKnowledgeManifestPath(), "utf8");
  const parsed = JSON.parse(raw) as KnowledgeManifest;
  if (!parsed?.domains?.length) {
    throw new Error("knowledge/manifest.json invalide : domains vide");
  }
  return {
    version: parsed.version ?? 1,
    description: parsed.description,
    alwaysInclude: parsed.alwaysInclude ?? ["general"],
    maxInjectChars: parsed.maxInjectChars ?? 3200,
    maxFiles: parsed.maxFiles ?? 3,
    domains: parsed.domains,
  };
}

/**
 * Charge toutes les fiches déclarées dans le manifest.
 * Les .md absents du manifest sont ignorés (déclaratifs).
 * Cache mémoire invalidé si le manifest change de taille/contenu basique.
 */
export async function loadKnowledgeCatalog(
  force = false,
): Promise<{ manifest: KnowledgeManifest; documents: KnowledgeDocument[] }> {
  const manifest = await readManifest();
  const key = `${manifest.version}:${manifest.domains.length}:${manifest.maxInjectChars}`;
  if (!force && catalogCache && catalogMtimeKey === key) {
    return { manifest, documents: catalogCache };
  }

  const root = getKnowledgeRoot();
  const documents: KnowledgeDocument[] = [];

  for (const domain of manifest.domains) {
    const filePath = path.join(root, domain.file);
    try {
      const raw = await readFile(filePath, "utf8");
      // Strip optional YAML frontmatter if present
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
      documents.push({
        id: domain.id,
        label: domain.label,
        file: domain.file,
        categories: domain.categories ?? [],
        aliases: domain.aliases ?? [],
        keywords: domain.keywords ?? [],
        body,
        sections: splitSections(body),
      });
    } catch {
      // Fichier manquant : on ignore pour rester résilient
    }
  }

  // Découverte bonus : .md présents mais non listés → inclus avec meta minimale
  // (permet d'ajouter un fichier + de le déclarer ensuite ; sans entrée manifest, keywords vides)
  try {
    const files = (await readdir(root)).filter(
      (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
    );
    const known = new Set(manifest.domains.map((d) => d.file));
    for (const file of files) {
      if (known.has(file)) continue;
      const id = file.replace(/\.md$/i, "");
      const raw = await readFile(path.join(root, file), "utf8");
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
      documents.push({
        id,
        label: id,
        file,
        categories: [],
        aliases: [],
        keywords: [],
        body,
        sections: splitSections(body),
      });
    }
  } catch {
    // ignore
  }

  catalogCache = documents;
  catalogMtimeKey = key;
  return { manifest, documents };
}

export function clearKnowledgeCache(): void {
  catalogCache = null;
  catalogMtimeKey = "";
}
