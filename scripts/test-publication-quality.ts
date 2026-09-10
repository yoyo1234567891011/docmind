/**
 * Publication quality — 8 familles (GO/NO-GO).
 * npx tsx --tsconfig tsconfig.json scripts/test-publication-quality.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { classifyDocumentHeuristic } from "../src/ai/classification/heuristic";
import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import {
  assertProdQualityCleanPayload,
  finalizeAnalysisForProd,
  PROD_QUALITY_FORBIDDEN_PATTERNS,
} from "../src/ai/post-processing/prod-quality";
import {
  resolveWatchDocFamily,
  type WatchDocFamily,
} from "../src/ai/post-processing/watch-ranking";
import { extractOrganizations } from "../src/services/extraction/people-orgs";
import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification, LetterType } from "../src/types";

function baseAnalysis(
  partial: Partial<DocumentAnalysis> &
    Pick<DocumentAnalysis, "document_type" | "title">,
): DocumentAnalysis {
  return {
    summary: "",
    date: "",
    dates: [],
    people: [],
    organizations: [],
    amounts: [],
    deadlines: [
      "Signaler sans délai tout changement d'adresse",
      "| Échéance n°1 | 100 € |",
      "Échéance : date à laquelle une obligation de paiement devient exigible.",
      "Délai moyen de traitement courrier : 10 jours ouvrés",
    ],
    important_points: [],
    risks: [],
    actions: [
      "Anticiper l'échéance : Signaler sans délai tout changement d'adresse",
      "Vérifier l'échéance: Délai impératif",
    ],
    risk_score: 40,
    risk_level: "modere",
    risk_explanation: "",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...partial,
  };
}

type Case = {
  name: string;
  file: string;
  family: WatchDocFamily;
  categoryOk?: RegExp;
  labelOk?: RegExp;
  orgOk: RegExp;
  findingOk: RegExp;
  letterSubjectOk: RegExp;
  letterBodyOk: RegExp;
  letterType?: LetterType;
  forbidFindings?: RegExp;
  forbidLetter?: RegExp;
};

const CASES: Case[] = [
  {
    name: "fiscal",
    file: "test-documents/impots/01-avis-fiscal-imp-946966.md",
    family: "administratif",
    categoryOk: /impots/,
    orgOk: /finances\s+publiques|dgfip/i,
    findingOk: /principal|total|majoration|recouvrement/i,
    letterSubjectOk: /contestation/i,
    letterBodyOk: /finances|principal|1\s*073|majoration/i,
    letterType: "contestation",
  },
  {
    name: "banque",
    file: "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
    family: "banque",
    categoryOk: /banque/,
    orgOk: /horizon|banque/i,
    findingOk: /frais|commission|tenue|rejet|int[ée]r[êe]t|ficp/i,
    letterSubjectOk: /frais bancaires|contestation/i,
    letterBodyOk: /horizon|banque|frais|commission/i,
    letterType: "contestation",
    forbidLetter: /bail|loyer|caf/i,
  },
  {
    name: "pret",
    file: "test-documents/contrats-de-pret/01-offre-de-pret-personnel-prt-637352.md",
    family: "pret",
    categoryOk: /contrat/,
    labelOk: /pr[êe]t/i,
    orgOk: /cr[ée]dit\s+serein|serein/i,
    findingOk: /capital|taeg|mensualit|r[ée]tractation|d[ée]ch[ée]ance|frais\s+de\s+dossier/i,
    letterSubjectOk: /cr[ée]dit|pr[êe]t/i,
    letterBodyOk: /pr[êe]t|cr[ée]dit|taeg|capital|mensualit/i,
    letterType: "autre",
    forbidFindings: /commission\s+d['']intervention|tenue\s+de\s+compte/i,
    forbidLetter: /relev[ée]\s+bancaire|\bbail\b|\bloyer\b|\bcaf\b|charges\s+locatives|frais\s+d[ée]bit[ée]s\s+sur\s+mon\s+compte/i,
  },
  {
    name: "caf",
    file: "test-documents/caf/01-notification-caf-caf-500877.md",
    family: "social",
    categoryOk: /courrier-administratif/,
    labelOk: /caf/i,
    orgOk: /caisse|allocations|caf/i,
    findingOk: /aide|indu|pi[èe]ce|suspension|trop/i,
    letterSubjectOk: /pi[èe]ces|droits|caf/i,
    letterBodyOk: /pi[èe]ces|aide|indu|caf|allocations/i,
    letterType: "reponse_administrative",
    forbidFindings: /^engagement\b|engagement\s+de\s+\d/i,
    forbidLetter: /bail|loyer|charges\s+locatives|cong[ée]|dgfip|relev[ée]\s+bancaire|huissier/i,
  },
  {
    name: "med",
    file: "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
    family: "recouvrement",
    orgOk: /recouvrement/i,
    findingOk: /total\s+r[ée]clam|principal|frais|p[ée]nalit/i,
    letterSubjectOk: /contestation|cr[ée]ance/i,
    letterBodyOk: /mise en demeure|cr[ée]ance|recouvrement/i,
    letterType: "contestation",
  },
  {
    name: "bail",
    file: "test-documents/baux-de-location/04-bail-location-bordeaux-bail-561304.md",
    family: "bail",
    categoryOk: /bail/,
    orgOk: /./,
    findingOk: /loyer|charges|d[ée]p[ôo]t/i,
    letterSubjectOk: /bail|location/i,
    letterBodyOk: /bail|loyer|charges|location/i,
    letterType: "autre",
    forbidLetter: /caf|taeg|relev[ée]\s+bancaire/i,
  },
  {
    name: "facture",
    file: "test-documents/factures-edf/01-facture-electricite-edf-572903.md",
    family: "facture",
    categoryOk: /facture/,
    orgOk: /./,
    findingOk: /total|ttc|montant|frais|pr[ée]l[eè]v|option/i,
    letterSubjectOk: /contestation|facture/i,
    letterBodyOk: /facture|montant|€/i,
    letterType: "contestation",
    forbidLetter: /bail|caf|offre\s+de\s+pr[êe]t/i,
  },
  {
    name: "abonnement",
    file: "test-documents/contrats-internet/01-contrat-internet-fibre-net-485785.md",
    family: "abonnement",
    orgOk: /./,
    findingOk: /engagement|r[ée]siliation|frais|forfait|fibre|option|tacite/i,
    letterSubjectOk: /contestation|r[ée]siliation|abonnement|facturation/i,
    letterBodyOk: /€|contrat|abonnement|forfait|fibre/i,
    letterType: "contestation",
    forbidLetter: /caf|bail de location|offre de cr[ée]dit/i,
  },
  {
    name: "assurance",
    file: "test-documents/assurances/01-contrat-assurance-habitation-ass-821915.md",
    family: "assurance",
    orgOk: /./,
    findingOk: /franchise|cotisation|prime|tacite|sinistre|garantie/i,
    letterSubjectOk: /assurance|pr[ée]cisions|r[ée]siliation/i,
    letterBodyOk: /assurance|franchise|cotisation|contrat/i,
    letterType: "reponse_administrative",
    forbidLetter: /caf|relev[ée]\s+bancaire|offre\s+de\s+pr[êe]t/i,
  },
];

function load(rel: string): string {
  const p = path.join(process.cwd(), rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

function runCase(c: Case) {
  const text = load(c.file);
  const heuristic = classifyDocumentHeuristic(text);
  if (c.categoryOk) {
    assert.match(
      heuristic.category,
      c.categoryOk,
      `${c.name} category=${heuristic.category}`,
    );
  }
  if (c.labelOk) {
    assert.match(
      heuristic.label,
      c.labelOk,
      `${c.name} label=${heuristic.label}`,
    );
  }

  const family = resolveWatchDocFamily({
    category: heuristic.category,
    documentType: heuristic.label,
    title: heuristic.label,
    textHint: text,
  });
  assert.equal(family, c.family, `${c.name} family=${family}`);

  const orgs = extractOrganizations(text);
  assert.ok(
    orgs.some((o) => c.orgOk.test(o)) || c.orgOk.source === ".",
    `${c.name} org manquante: ${orgs.join(" | ") || "(vide)"}`,
  );

  const findings = mergeWithLocalRiskFindings([], text, {
    category: heuristic.category,
    documentType: heuristic.label,
  });

  const classification: DocumentClassification = {
    category: heuristic.category,
    label: heuristic.label,
    confidence: heuristic.confidence,
  };

  const out = finalizeAnalysisForProd(
    baseAnalysis({
      document_type: heuristic.label,
      title: heuristic.label,
      organizations: orgs,
      amounts: findings
        .map((f) => f.description)
        .filter((d) => /\d/.test(d))
        .slice(0, 8),
      risk_findings: findings,
    }),
    classification,
    text,
  );

  assert.ok(out.summary.trim().length >= 40, `${c.name} résumé trop court`);
  assert.ok(/[.!?…]/.test(out.summary), `${c.name} résumé sans phrase`);
  assert.ok(
    !out.actions.some((a) => /changement\s+d['']adresse/i.test(a)),
    `${c.name} action changement d'adresse`,
  );
  assert.ok(
    !out.deadlines.some((d) =>
      /d[ée]lai\s+moyen\s+de\s+traitement|changement\s+d['']adresse|Échéance n°/i.test(
        d,
      ),
    ),
    `${c.name} échéance bruit`,
  );

  for (const pattern of PROD_QUALITY_FORBIDDEN_PATTERNS) {
    assert.ok(
      !pattern.test(out.summary),
      `${c.name} résumé forbidden ${pattern}`,
    );
  }
  assertProdQualityCleanPayload({
    summary: out.summary,
    deadlines: out.deadlines,
    actions: out.actions,
    findings: out.risk_findings.map((f) => f.description),
    importantPoints: out.important_points,
    risks: out.risks,
    riskExplanation: out.risk_explanation,
  });

  const findingBlob = out.risk_findings
    .map((f) => `${f.criterion_id}:${f.description}`)
    .join("\n");
  assert.ok(
    c.findingOk.test(findingBlob) || c.findingOk.test(out.amounts.join("\n")),
    `${c.name} finding manquant: ${findingBlob.slice(0, 400)}`,
  );
  if (c.forbidFindings) {
    assert.ok(
      !out.risk_findings.some((f) => c.forbidFindings!.test(f.description)),
      `${c.name} finding interdit: ${findingBlob}`,
    );
  }

  assert.ok(
    out.risk_findings.length >= 1 && out.risk_findings.length <= 6,
    `${c.name} watch count=${out.risk_findings.length}`,
  );
  assert.ok(
    out.deadlines.length <= 3,
    `${c.name} trop d'échéances: ${out.deadlines.length}`,
  );

  if (c.name === "caf") {
    const copyBlob = out.risk_findings
      .map(
        (f) =>
          `${f.description}\n${f.why}\n${f.implication}\n${f.consequence}\n${f.mitigation}`,
      )
      .join("\n");
    assert.ok(
      !/huissier|saisie|mise\s+en\s+demeure|mat[ée]riel|r[ée]siliation\s+anticip/i.test(
        copyBlob,
      ),
      `CAF copy hors contexte: ${copyBlob.slice(0, 400)}`,
    );
    assert.ok(
      out.risk_findings.some((f) => /aide\s+mensuelle\s*:\s*483/i.test(f.description)) ||
        out.amounts.some((a) => /aide\s+mensuelle\s*:\s*483/i.test(a)),
      `CAF aide non labellisée: ${findingBlob}`,
    );
    const delais = out.risk_criteria.find((x) => x.id === "delais");
    assert.ok(
      (delais?.score ?? 0) > 0 ||
        out.risk_findings.some((f) => f.criterion_id === "delais"),
      "CAF délais sous-scoré",
    );
  }

  if (c.name === "pret") {
    const copyBlob = out.risk_findings
      .map((f) => `${f.implication}\n${f.consequence}\n${f.why}`)
      .join("\n");
    assert.ok(
      !/d[ée]couvert|commission\s+d['']intervention|relev[ée]\s+bancaire/i.test(
        copyBlob,
      ),
      `prêt copy hors contexte: ${copyBlob.slice(0, 300)}`,
    );
  }

  const letter = buildFallbackLetter(
    c.letterType ?? "contestation",
    out,
    classification,
    "publication test",
    text,
  );
  assert.ok(
    letter.recipient.trim().length > 0 ||
      /Madame,\s*Monsieur/i.test(letter.body),
    `${c.name} destinataire vide`,
  );
  const person0 = out.people?.find((p) => typeof p === "string" && p.trim());
  if (person0 && letter.recipient.trim()) {
    const norm = (v: string) =>
      v
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/['’]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    assert.ok(
      norm(letter.recipient) !== norm(person0) &&
        !norm(letter.recipient).includes(norm(person0)),
      `${c.name} recipient = persons[0] (${person0}): ${letter.recipient}`,
    );
  }
  assert.ok(!/\[Destinataire\]/i.test(letter.body), `${c.name} [Destinataire]`);
  assert.ok(
    !/v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i.test(letter.body),
    `${c.name} libellé UI`,
  );
  assert.match(letter.subject, c.letterSubjectOk, `${c.name} subject`);
  assert.match(
    `${letter.subject}\n${letter.body}`,
    c.letterBodyOk,
    `${c.name} letter body`,
  );
  if (c.forbidLetter) {
    assert.ok(
      !c.forbidLetter.test(letter.body),
      `${c.name} letter hors sujet: ${letter.subject}`,
    );
  }
  if (c.name === "caf") {
    assert.ok(
      /À l'attention de la Caisse/i.test(letter.body),
      `CAF article: ${letter.body.slice(0, 200)}`,
    );
    assert.ok(
      /aide\s+mensuelle|483/i.test(letter.body) && /indu|447/i.test(letter.body),
      `CAF letter montants: ${letter.body.slice(0, 500)}`,
    );
    assert.ok(
      /transmission\s+des?\s+(?:pi[èe]ces|justificatifs)|pi[èe]ces?\s+demand/i.test(
        letter.body,
      ),
      "CAF letter sans transmission de pièces",
    );
  }
  if (c.name === "pret") {
    assert.ok(
      /À l'attention du Cr[ée]dit/i.test(letter.body),
      `prêt article: ${letter.body.slice(0, 200)}`,
    );
    assert.ok(
      /capital|taeg|mensualit/i.test(letter.body),
      "prêt letter sans faits labellisés",
    );
  }

  console.log(`OK ${c.name}`);
  console.log(`  type: ${heuristic.category} / ${heuristic.label} → ${family}`);
  console.log(`  org: ${orgs[0] ?? "(vide)"}`);
  console.log(`  résumé: « ${out.summary.slice(0, 140)} »`);
  console.log(
    `  watch: ${out.risk_findings
      .slice(0, 3)
      .map((f) => f.description)
      .join(" | ")}`,
  );
  console.log(`  letter: ${letter.subject}`);
}

function main() {
  // Avant/après spot-check prêt + CAF
  {
    const pret = load(
      "test-documents/contrats-de-pret/01-offre-de-pret-personnel-prt-637352.md",
    );
    const h = classifyDocumentHeuristic(pret);
    assert.notEqual(h.category, "banque", "NO-GO: prêt encore classé banque");
    assert.equal(
      resolveWatchDocFamily({
        category: h.category,
        documentType: h.label,
        textHint: pret,
      }),
      "pret",
    );
  }
  {
    const caf = load("test-documents/caf/01-notification-caf-caf-500877.md");
    const h = classifyDocumentHeuristic(caf);
    assert.match(h.label, /caf/i);
    assert.equal(
      resolveWatchDocFamily({
        category: h.category,
        documentType: h.label,
        textHint: caf,
      }),
      "social",
    );
  }

  for (const c of CASES) {
    // assurance fixture id may vary
    if (c.name === "assurance" && !existsSync(path.join(process.cwd(), c.file))) {
      const alt = [
        "test-documents/assurances/01-contrat-assurance-habitation-ass-246810.md",
        "test-documents/mutuelles/01-contrat-mutuelle-sante-mut-100001.md",
      ].find((f) => existsSync(path.join(process.cwd(), f)));
      assert.ok(alt, "no assurance/mutuelle fixture");
      runCase({ ...c, file: alt!, family: "assurance" });
      continue;
    }
    runCase(c);
  }

  console.log("\nALL publication-quality tests passed.");
  console.log("Prêt publication (automatisé): OUI — sous réserve OCR / Groq TPM.");
}

main();
