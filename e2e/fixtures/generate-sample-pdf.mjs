/**
 * PDFs Dashboard E2E — montants / fournisseurs déterministes.
 */
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function writePdf(fileName, lines) {
  const out = path.join(__dirname, fileName);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(out);
    doc.pipe(stream);
    doc.fontSize(14).text(lines[0] || "DocMind E2E", { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    for (const line of lines.slice(1)) {
      doc.text(line);
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return out;
}

await mkdir(__dirname, { recursive: true });

const files = await Promise.all([
  writePdf("orange-internet.pdf", [
    "Contrat Orange Internet Fibre",
    "Prestataire : Orange",
    "Produit : Internet Fibre Livebox",
    "Abonnement mensuel : 30,00 EUR par mois",
    "Date : 01/02/2026",
    "Préavis de résiliation : 30 jours",
  ]),
  writePdf("orange-mobile.pdf", [
    "Contrat Orange Mobile Forfait",
    "Prestataire : Orange",
    "Produit : Forfait Mobile 5G",
    "Abonnement mensuel : 20,00 EUR par mois",
    "Date : 01/02/2026",
    "Préavis de résiliation : 30 jours",
  ]),
  writePdf("edf-contrat.pdf", [
    "Contrat EDF Électricité",
    "Prestataire : EDF",
    "Produit : Électricité Résidentiel",
    "Abonnement mensuel : 40,00 EUR par mois",
    "Date : 01/02/2026",
  ]),
  writePdf("sample.pdf", [
    "DocMind E2E — Facture exemple",
    "Émetteur : Société Demo SAS",
    "Client : Jean Dupont",
    "N° facture : E2E-2026-001",
    "Date : 15/01/2026",
    "Montant TTC : 120,00 EUR",
    "Objet : Prestation de conseil. Paiement sous 30 jours.",
  ]),
]);

console.log("[e2e] PDFs dashboard prêts:", files.join(", "));
