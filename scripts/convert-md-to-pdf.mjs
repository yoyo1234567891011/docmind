import { access, readdir, readFile } from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const ROOT = path.join(process.cwd(), "test-documents");

const FONT_CANDIDATES = [
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\calibri.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
];

async function walkMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(fullPath)));
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (lower === "readme.md") continue;
    if (lower.endsWith(".md")) files.push(fullPath);
  }

  return files.sort((a, b) => a.localeCompare(b, "fr"));
}

function resolveFont() {
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function markdownToPlainText(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^\*.*Document fictif.*\*$/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function writePdf(text, outputPath, fontPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      info: {
        Title: path.basename(outputPath, ".pdf"),
        Author: "DocMind test corpus",
      },
    });

    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    if (fontPath) {
      doc.font(fontPath);
    }

    doc.fontSize(11).text(text, {
      align: "left",
      lineGap: 2,
    });

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const fontPath = resolveFont();
  if (!fontPath) {
    console.warn(
      "Aucune police système trouvée — caractères accentués potentiellement limités.",
    );
  } else {
    console.log(`Police: ${fontPath}`);
  }

  const markdownFiles = await walkMarkdown(ROOT);
  let created = 0;
  let skipped = 0;

  for (const mdPath of markdownFiles) {
    const pdfPath = mdPath.replace(/\.md$/i, ".pdf");
    if (!force && (await exists(pdfPath))) {
      skipped += 1;
      continue;
    }

    const markdown = await readFile(mdPath, "utf8");
    const text = markdownToPlainText(markdown);
    await writePdf(text || "(document vide)", pdfPath, fontPath);
    created += 1;
    process.stdout.write(`✓ ${path.relative(ROOT, pdfPath)}\n`);
  }

  console.log(
    `\nPDF générés: ${created} · déjà présents: ${skipped} · total MD: ${markdownFiles.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
