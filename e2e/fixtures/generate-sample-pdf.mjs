/**
 * Génère e2e/fixtures/sample.pdf (idempotent).
 */
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "sample.pdf");

await mkdir(__dirname, { recursive: true });

await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 50 });
  const stream = createWriteStream(out);
  doc.pipe(stream);
  doc.fontSize(16).text("DocMind E2E — Facture exemple", { underline: true });
  doc.moveDown();
  doc.fontSize(11).text("Émetteur : Société Demo SAS");
  doc.text("Client : Jean Dupont");
  doc.text("N° facture : E2E-2026-001");
  doc.text("Date : 15/01/2026");
  doc.text("Montant TTC : 120,00 EUR");
  doc.moveDown();
  doc.text(
    "Objet : Prestation de conseil. Paiement sous 30 jours. Pénalités de retard applicables.",
  );
  doc.end();
  stream.on("finish", resolve);
  stream.on("error", reject);
});

console.log("[e2e] sample.pdf prêt:", out);
