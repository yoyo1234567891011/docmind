/**
 * Import simple d’un document réel → anonymisation → corpus évaluable.
 *
 * Usage:
 *   npm run corpus:import -- path/to/doc.pdf --type Bail --slug bail-t2
 *   npm run corpus:import -- corpus/inbox/facture.pdf --people "Jean Dupont=Alice Martin" --orgs "SCI Dupont=SCI Exemple"
 *   npm run corpus:import -- --inbox   # traite tous les PDF/MD de corpus/inbox
 *
 * Sortie:
 *   test-documents/real-anonymized/<sous-categorie>/NN-slug.{md,pdf,_expected.json}
 *   corpus/manifest.json
 */

import { createWriteStream, existsSync } from "fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { extractText } from "unpdf";

import {
  anonymizeDocumentText,
  CORPUS_CATEGORY,
  CORPUS_INBOX_DIR,
  CORPUS_MANIFEST_PATH,
  draftExpectedAnalysis,
  pagesToMarkdown,
  parsePairList,
  REAL_ANONYMIZED_DIR,
} from "@/services/corpus";

type CliOptions = {
  inputs: string[];
  inbox: boolean;
  type?: string;
  slug?: string;
  subcategory?: string;
  people?: string;
  orgs?: string;
  replace?: string;
  title?: string;
  noPdf?: boolean;
  dryRun?: boolean;
};

type ManifestEntry = {
  id: string;
  sourceName: string;
  relativePath: string;
  subcategory: string;
  documentType: string;
  importedAt: string;
  replacements: number;
  stats: Record<string, number>;
};

type ManifestFile = {
  version: 1;
  category: string;
  entries: ManifestEntry[];
};

const FONT_CANDIDATES = [
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\calibri.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { inputs: [], inbox: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--inbox") options.inbox = true;
    else if (arg === "--type") options.type = argv[++i];
    else if (arg === "--slug") options.slug = argv[++i];
    else if (arg === "--subcategory" || arg === "--cat")
      options.subcategory = argv[++i];
    else if (arg === "--people") options.people = argv[++i];
    else if (arg === "--orgs") options.orgs = argv[++i];
    else if (arg === "--replace") options.replace = argv[++i];
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--no-pdf") options.noPdf = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      options.inputs.push(arg);
    } else {
      throw new Error(`Option inconnue: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Import corpus réel anonymisé

Usage:
  npm run corpus:import -- <fichier.pdf|md> [options]
  npm run corpus:import -- --inbox

Options:
  --type <label>         document_type pour le golden (ex: Bail)
  --slug <slug>          nom de fichier (sinon dérivé du fichier)
  --subcategory <id>     sous-dossier (ex: bail) — défaut: general
  --people "A=B;C=D"     remplacements personnes
  --orgs "A=B"           remplacements organisations
  --replace "A=B"        remplacements libres
  --title "..."          titre markdown / golden
  --no-pdf               ne pas régénérer le PDF
  --dry-run              affiche le résultat sans écrire
  --inbox                importe tous les .pdf/.md de corpus/inbox/
`);
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function resolveFont(): string | null {
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadManifest(): Promise<ManifestFile> {
  try {
    const raw = await readFile(CORPUS_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as ManifestFile;
    if (!parsed.entries) parsed.entries = [];
    return parsed;
  } catch {
    return { version: 1, category: CORPUS_CATEGORY, entries: [] };
  }
}

async function nextIndex(subDir: string): Promise<number> {
  await mkdir(subDir, { recursive: true });
  const names = await readdir(subDir);
  let max = 0;
  for (const name of names) {
    const m = /^(\d+)-/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function extractSource(
  filePath: string,
): Promise<{ pages: string[]; text: string }> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) {
    const text = await readFile(filePath, "utf8");
    return { pages: [text], text };
  }
  if (!lower.endsWith(".pdf")) {
    throw new Error(`Format non supporté: ${filePath} (PDF, MD ou TXT)`);
  }

  const bytes = await readFile(filePath);
  const result = await extractText(new Uint8Array(bytes), {
    mergePages: false,
  });
  const pages = (Array.isArray(result.text) ? result.text : [result.text])
    .map((page) => (typeof page === "string" ? page.trim() : ""))
    .filter((page) => page.length > 0);

  const text =
    pages.length > 0
      ? pages
          .map((page, i) => `<<<PAGE ${i + 1}>>>\n${page}\n<<<FIN_PAGE ${i + 1}>>>`)
          .join("\n\n")
      : "";

  return { pages, text };
}

function writePdfFromMarkdown(
  markdown: string,
  outputPath: string,
  fontPath: string | null,
): Promise<void> {
  const text = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^<!--[\s\S]*?-->\s*/m, "")
    .replace(/^>\s.*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/<<<PAGE \d+>>>/g, "\n———\n")
    .replace(/<<<FIN_PAGE \d+>>>/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      info: {
        Title: path.basename(outputPath, ".pdf"),
        Author: "DocMind corpus anonymisé",
      },
    });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    if (fontPath) doc.font(fontPath);
    doc.fontSize(11).text(text, { align: "left", lineGap: 2 });
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

async function listInboxFiles(): Promise<string[]> {
  await mkdir(CORPUS_INBOX_DIR, { recursive: true });
  const names = await readdir(CORPUS_INBOX_DIR);
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      if (lower === ".gitkeep" || lower === "readme.md") return false;
      return (
        lower.endsWith(".pdf") ||
        lower.endsWith(".md") ||
        lower.endsWith(".txt")
      );
    })
    .map((name) => path.join(CORPUS_INBOX_DIR, name))
    .sort((a, b) => a.localeCompare(b, "fr"));
}

async function importOne(
  filePath: string,
  options: CliOptions,
  fontPath: string | null,
): Promise<ManifestEntry> {
  const sourceName = path.basename(filePath);
  const subcategory = slugify(options.subcategory || "general") || "general";
  const baseSlug =
    options.slug?.trim() ||
    slugify(sourceName.replace(/\.(pdf|md|txt)$/i, "")) ||
    "document";

  const { pages, text } = await extractSource(filePath);
  if (!text.trim()) {
    throw new Error(
      `${sourceName}: aucun texte extractible (PDF scanné ?). Fournissez un .md/.txt ou un PDF avec couche texte.`,
    );
  }

  const explicitPeople = parsePairList(options.people);
  const baseOptions = {
    people: explicitPeople,
    organizations: parsePairList(options.orgs),
    custom: parsePairList(options.replace),
    // Si l’utilisateur fournit les personnes, on évite les faux positifs heuristiques
    disableNameHeuristic: explicitPeople.length > 0,
  };
  const anonymized = anonymizeDocumentText(text, baseOptions);

  // Réutilise le même mapping pour chaque page (cohérence cross-page)
  const syncedOptions = {
    ...baseOptions,
    people: [
      ...baseOptions.people,
      ...anonymized.replacements
        .filter((r) => r.kind === "person")
        .map((r) => ({ from: r.original, to: r.replacement })),
    ],
    organizations: [
      ...baseOptions.organizations,
      ...anonymized.replacements
        .filter((r) => r.kind === "organization")
        .map((r) => ({ from: r.original, to: r.replacement })),
    ],
    custom: [
      ...baseOptions.custom,
      ...anonymized.replacements
        .filter((r) =>
          ["email", "phone", "iban", "bic", "nir", "siret", "siren", "address", "custom"].includes(
            r.kind,
          ),
        )
        .map((r) => ({ from: r.original, to: r.replacement })),
    ],
    disableNameHeuristic: true as const,
  };

  const pageBodies =
    pages.length > 0
      ? pages.map((page) => anonymizeDocumentText(page, syncedOptions).text)
      : [anonymized.text];

  const title =
    options.title?.trim() ||
    options.type?.trim() ||
    baseSlug.replace(/-/g, " ");

  const markdown = pagesToMarkdown(pageBodies, title);
  const expected = draftExpectedAnalysis({
    text: anonymized.text,
    documentType: options.type,
    title,
    replacements: anonymized.replacements,
  });

  const outDir = path.join(REAL_ANONYMIZED_DIR, subcategory);
  const index = await nextIndex(outDir);
  const stem = `${String(index).padStart(2, "0")}-${baseSlug}`;
  const mdPath = path.join(outDir, `${stem}.md`);
  const pdfPath = path.join(outDir, `${stem}.pdf`);
  const expectedPath = path.join(outDir, `${stem}_expected.json`);
  const relativePath = path
    .join(CORPUS_CATEGORY, subcategory, `${stem}.pdf`)
    .replace(/\\/g, "/");

  console.log(`\n→ ${sourceName}`);
  console.log(`  remplacements: ${anonymized.replacements.length}`, anonymized.stats);
  console.log(`  sortie: ${relativePath}`);

  if (options.dryRun) {
    console.log("  [dry-run] aucune écriture");
    return {
      id: stem,
      sourceName,
      relativePath,
      subcategory,
      documentType: expected.document_type,
      importedAt: new Date().toISOString(),
      replacements: anonymized.replacements.length,
      stats: anonymized.stats,
    };
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(
    expectedPath,
    `${JSON.stringify(expected, null, 2)}\n`,
    "utf8",
  );

  if (!options.noPdf) {
    await writePdfFromMarkdown(markdown, pdfPath, fontPath);
  }

  // Archive source brute hors git (copie dans inbox/processed)
  const processedDir = path.join(CORPUS_INBOX_DIR, "_processed");
  await mkdir(processedDir, { recursive: true });
  const archiveName = `${stem}__${sourceName}`;
  await copyFile(filePath, path.join(processedDir, archiveName)).catch(
    () => undefined,
  );

  // Mapping local (peut contenir des originaux) — gitignoré
  const mapPath = path.join(outDir, `${stem}.replacements.json`);
  await writeFile(
    mapPath,
    `${JSON.stringify(
      {
        warning:
          "Peut contenir des données personnelles d’origine — ne pas committer.",
        replacements: anonymized.replacements,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    id: stem,
    sourceName,
    relativePath,
    subcategory,
    documentType: expected.document_type,
    importedAt: new Date().toISOString(),
    replacements: anonymized.replacements.length,
    stats: anonymized.stats,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputs = options.inbox
    ? await listInboxFiles()
    : options.inputs.map((p) => path.resolve(p));

  if (inputs.length === 0) {
    printHelp();
    console.error(
      "\nAucun fichier. Placez des PDF/MD dans corpus/inbox/ puis: npm run corpus:import -- --inbox",
    );
    process.exit(1);
  }

  await mkdir(REAL_ANONYMIZED_DIR, { recursive: true });
  await mkdir(CORPUS_INBOX_DIR, { recursive: true });

  const fontPath = resolveFont();
  const manifest = await loadManifest();
  let ok = 0;

  for (const filePath of inputs) {
    if (!existsSync(filePath)) {
      console.error(`Fichier introuvable: ${filePath}`);
      process.exitCode = 1;
      continue;
    }
    try {
      const entry = await importOne(filePath, options, fontPath);
      manifest.entries = manifest.entries.filter((e) => e.id !== entry.id);
      manifest.entries.push(entry);
      ok += 1;
    } catch (error) {
      console.error(
        `Échec ${filePath}:`,
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    }
  }

  if (!options.dryRun) {
    await mkdir(path.dirname(CORPUS_MANIFEST_PATH), { recursive: true });
    await writeFile(
      CORPUS_MANIFEST_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(
    `\nTerminé: ${ok}/${inputs.length} document(s). Évaluer avec:\n` +
      `  npm run evaluate -- --corpus real\n` +
      `  npm run test:docs -- --corpus real\n` +
      `Complétez les TODO dans *_expected.json avant une eval sérieuse.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
