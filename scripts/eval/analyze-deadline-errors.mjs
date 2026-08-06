import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";

function decode(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function listItems(tdHtml) {
  if (!tdHtml) return [];
  if (/<em>Aucun<\/em>|<em>—<\/em>/.test(tdHtml)) return [];
  return [...tdHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
    decode(m[1]),
  );
}

function stripPrefix(value) {
  return value
    .replace(/^En trop:\s*/i, "")
    .replace(/^Manquant:\s*/i, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function parseDeadlines(html, reportLabel) {
  const sections = html.split(/<section class="card">/).slice(1);
  const cases = [];

  for (const section of sections) {
    if (!section.includes(".pdf")) continue;
    const pathMatch = section.match(
      /class="muted">((?:[^<]+\/)?[^<]+\.pdf)/,
    );
    const fileMatch = section.match(/<h2>([^<]+\.pdf)<\/h2>/);
    const relative = (pathMatch?.[1] || fileMatch?.[1] || "")
      .trim()
      .replace(/\\/g, "/");
    if (!relative.endsWith(".pdf")) continue;

    const rowMatch = section.match(
      /<tr>\s*<td>\s*<code>deadlines<\/code>[\s\S]*?<\/tr>/,
    );
    if (!rowMatch) continue;
    const row = rowMatch[0];
    const status = row.match(/badge-([a-z]+)/)?.[1] ?? "?";
    const fieldScore = Number(row.match(/<td>(\d+)%<\/td>/)?.[1] ?? 0);
    const tds = [...row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1],
    );
    const predicted = listItems(tds[5]);
    const errors = listItems(tds[6]).map(stripPrefix);
    const omissions = listItems(tds[7]).map(stripPrefix);

    if (status === "correct" && errors.length === 0 && omissions.length === 0) {
      continue;
    }

    cases.push({
      report: reportLabel,
      file: relative,
      status,
      fieldScore,
      predicted,
      errors,
      omissions,
    });
  }
  return cases;
}

function loadPair(relativePdf) {
  const base = relativePdf.replace(/\.pdf$/i, "");
  const expectedPath = path.join(
    process.cwd(),
    "test-documents",
    `${base}_expected.json`,
  );
  const mdPath = path.join(process.cwd(), "test-documents", `${base}.md`);
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  const md = readFileSync(mdPath, "utf8");
  return { expected, md, base };
}

function hasNoise(value) {
  return (
    value.length > 120 ||
    /Assureur fictif|Adresse du risque|Cotisation\s*•|Clauses importantes|contrat d'assurance habitation —/i.test(
      value,
    )
  );
}

function isBareDate(value) {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value.trim());
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function classifyFinding(kind, value, expected, md) {
  const v = value.trim();
  const mdLower = md.toLowerCase();
  const expectedDeadlines = expected.deadlines ?? [];

  if (hasNoise(v)) {
    return {
      source: "prompt",
      label: "Prompt / extraction",
      issue: "Bruit (en-tête ou paragraphe) injecté dans deadlines",
      fix: "Filtrer les extraits >120 car. et les lignes d'en-tête; n'émettre que des échéances concises.",
    };
  }

  if (
    /pénalité|sanction possible|frais de dossier|franchise|cotisation mensuelle/i.test(
      v,
    ) &&
    !/avant le|délai|jours|échéance|préavis/i.test(v)
  ) {
    return {
      source: "prompt",
      label: "Prompt",
      issue: "Risque/pénalité classé à tort comme deadline",
      fix: "Interdire dans le prompt de mettre pénalités/sanctions dans deadlines (réserver à risks).",
    };
  }

  if (/paiement|prélèvement|le 5 de chaque mois/i.test(v)) {
    return {
      source: "prompt",
      label: "Prompt",
      issue: "Récurrence de paiement traitée comme échéance limite",
      fix: "Exclure explicitement les échéances de prélèvement récurrentes hors date limite.",
    };
  }

  if (kind === "en_trop" && isIsoDate(v)) {
    return {
      source: "systeme_comparaison",
      label: "Système de comparaison",
      issue: `Date ISO « ${v} » non alignée avec le format JJ/MM/AAAA de expected`,
      fix: "Normaliser les dates (JJ/MM/AAAA) avant comparaison.",
    };
  }

  // Full sentence about modification vs bare date in expected
  if (
    kind === "en_trop" &&
    /demande de modification|adressée? avant le/i.test(v)
  ) {
    const dateInValue = v.match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0];
    if (dateInValue && expectedDeadlines.includes(dateInValue)) {
      return {
        source: "systeme_comparaison",
        label: "Système de comparaison (+ expected trop minimal)",
        issue:
          "Phrase d'échéance correcte rejetée car expected n'a que la date nue",
        fix: "Soit comparaison sémantique/normalisation date↔phrase, soit enrichir expected avec la phrase du document.",
      };
    }
    if (dateInValue && md.includes(dateInValue)) {
      return {
        source: "expected_json",
        label: "Fichier *_expected.json",
        issue:
          "Échéance de modification présente dans le document, absente ou sous-spécifiée dans expected",
        fix: `Ajouter dans expected: « Toute demande de modification doit être adressée avant le ${dateInValue} ».`,
      };
    }
  }

  // Relative dénonciation 60 jours
  if (/60\s*jours|dénonciation/i.test(v) || (kind === "manquant" && /60\s*jours|dénonciation/i.test(v))) {
    const docHas60 = /60\s*jours/i.test(md);
    const docHasDenonciation = /dénonciation/i.test(md);
    const expectedHas60 = expectedDeadlines.some((d) =>
      /60\s*jours|dénonciation/i.test(d),
    );

    if (kind === "manquant" && expectedHas60 && !docHas60) {
      return {
        source: "expected_json",
        label: "Fichier *_expected.json",
        issue:
          "Expected impose « 60 jours / dénonciation » mais le document parle d'une autre formule (ex: résiliation par LR)",
        fix: "Aligner expected sur le texte source (ou régénérer les docs pour toujours inclure la clause 60 jours).",
      };
    }

    if (kind === "manquant" && expectedHas60 && docHas60) {
      return {
        source: "prompt",
        label: "Prompt",
        issue: "Délai relatif présent dans le document mais non extrait",
        fix: "Renforcer extraction des délais relatifs (« X jours avant l'échéance »).",
      };
    }

    if (kind === "en_trop" && expectedHas60 && (docHas60 || docHasDenonciation)) {
      return {
        source: "systeme_comparaison",
        label: "Système de comparaison",
        issue: "Paraphrase du délai de dénonciation non matchée lexicalement",
        fix: "Comparer deadlines en sémantique, ou normaliser les formulations de préavis.",
      };
    }
  }

  if (kind === "manquant") {
    const tokens = v
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 4);
    const inDoc = tokens.filter((t) => mdLower.includes(t)).length >= Math.ceil(tokens.length * 0.6);
    if (!inDoc) {
      return {
        source: "expected_json",
        label: "Fichier *_expected.json",
        issue: "Attendu peu/pas présent dans le document de test",
        fix: "Corriger expected ou enrichir le document source.",
      };
    }
    return {
      source: "prompt",
      label: "Prompt",
      issue: "Échéance documentaire non extraite",
      fix: "Améliorer le prompt / extraction déterministe pour ce pattern.",
    };
  }

  // en_trop residual: check if paraphrase of expected bare date sentence
  if (isBareDate(v) === false) {
    for (const exp of expectedDeadlines) {
      if (isBareDate(exp) && v.includes(exp)) {
        return {
          source: "systeme_comparaison",
          label: "Système de comparaison",
          issue: "Reformulation contenant la date attendue, rejetée par matching lexical",
          fix: "Normaliser: si une prédiction contient la date expected, la compter correcte.",
        };
      }
    }
  }

  return {
    source: "prompt",
    label: "Prompt",
    issue: "Sur-extraction / entrée non attendue",
    fix: "Restreindre deadlines aux dates limites et délais relatifs actionnables.",
  };
}

const reports = [
  ["reports/eval-report-2026-07-24T12-57-49-722Z.html", "quick-2026-07-24"],
  ["reports/eval-report-2026-07-17T20-30-00-102Z.html", "full-2026-07-17"],
];

const allCases = [];
for (const [file, label] of reports) {
  const html = readFileSync(path.join(process.cwd(), file), "utf8");
  allCases.push(...parseDeadlines(html, label));
}

// Prefer latest quick over older duplicates for same file when building detail for quick;
// For full report keep all.
const detailed = [];
for (const c of allCases) {
  const { expected, md } = loadPair(c.file);
  const findings = [];
  for (const err of c.errors) {
    findings.push({
      kind: "en_trop",
      value: err,
      ...classifyFinding("en_trop", err, expected, md),
    });
  }
  for (const miss of c.omissions) {
    findings.push({
      kind: "manquant",
      value: miss,
      ...classifyFinding("manquant", miss, expected, md),
    });
  }

  // Also surface structural mismatches even if parser swapped columns in old reports
  for (const pred of c.predicted) {
    if (c.errors.includes(pred) || c.omissions.includes(pred)) continue;
  }

  detailed.push({
    ...c,
    expectedDeadlines: expected.deadlines,
    findings,
  });
}

const bySource = {};
const byIssue = {};
for (const c of detailed) {
  for (const f of c.findings) {
    bySource[f.source] = (bySource[f.source] || 0) + 1;
    byIssue[f.issue] = (byIssue[f.issue] || 0) + 1;
  }
}

// Generator audit: expected 60j vs document
const generatorMismatches = [];
const root = path.join(process.cwd(), "test-documents");
for (const cat of readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)) {
  for (const f of readdirSync(path.join(root, cat)).filter((x) =>
    x.endsWith("_expected.json"),
  )) {
    const base = f.replace(/_expected\.json$/, "");
    const expected = JSON.parse(
      readFileSync(path.join(root, cat, f), "utf8"),
    );
    const md = readFileSync(path.join(root, cat, `${base}.md`), "utf8");
    const expects60 = (expected.deadlines || []).some((d) =>
      /60\s*jours/i.test(d),
    );
    if (expects60 && !/60\s*jours/i.test(md)) {
      generatorMismatches.push(`${cat}/${base}`);
    }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  sources: {
    quick: "reports/eval-report-2026-07-24T12-57-49-722Z.html",
    full: "reports/eval-report-2026-07-17T20-30-00-102Z.html",
  },
  totals: {
    documentsIncorrect: detailed.length,
    findings: detailed.reduce((n, c) => n + c.findings.length, 0),
    bySource,
    topIssues: Object.entries(byIssue)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    expected60DaysMissingInDocument: generatorMismatches.length,
    generatorMismatchSamples: generatorMismatches.slice(0, 20),
  },
  cases: detailed,
};

writeFileSync(
  path.join(process.cwd(), "reports/deadline-errors-analysis.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out.totals, null, 2));
