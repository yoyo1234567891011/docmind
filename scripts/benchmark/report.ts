import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { suiteLabel } from "./corpus";
import { mean } from "./score";
import type {
  BenchmarkProviderId,
  BenchmarkRunResult,
  BenchmarkSuiteId,
  DocProviderScore,
  ProviderAggregate,
} from "./types";
import { CLOUD_PROVIDERS } from "./providers/cloud";

const PROVIDER_LABELS: Record<BenchmarkProviderId, string> = {
  docmind: "DocMind",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  mistral: "Mistral Le Chat",
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.round(n)} ms`;
}

export function aggregateScores(
  scores: DocProviderScore[],
  enabled: Array<{ id: BenchmarkProviderId; enabled: boolean; skipReason?: string; model: string }>,
): ProviderAggregate[] {
  const suites: BenchmarkSuiteId[] = ["contrat", "facture", "courrier", "ocr"];
  return enabled.map((p) => {
    const all = scores.filter((s) => s.provider === p.id);
    const rows = all.filter((s) => !s.error);
    const bySuite = {} as ProviderAggregate["bySuite"];
    for (const suite of suites) {
      const subset = rows.filter((r) => r.suites.includes(suite));
      bySuite[suite] = {
        quality: mean(subset.map((r) => r.quality)),
        docs: subset.length,
      };
    }
    const timed = all.length > 0 ? all : rows;
    return {
      provider: p.id,
      label: PROVIDER_LABELS[p.id],
      enabled: p.enabled,
      skipReason:
        p.skipReason ||
        (p.enabled && rows.length === 0 && all.length > 0
          ? `${all.length} doc(s) en erreur (ex. Ollama down)`
          : undefined),
      model: p.model || all[0]?.model || "—",
      docs: rows.length,
      quality: mean(rows.map((r) => r.quality)),
      hallucinationRate: mean(rows.map((r) => r.hallucinationRate)),
      citationRate: mean(rows.map((r) => r.citationRate)),
      ocrRecall: mean(rows.map((r) => r.ocrRecall)),
      avgDurationMs: mean(timed.map((r) => r.durationMs)),
      bySuite,
    };
  });
}

/** Résumé narratif des différences mesurées. */
export function buildDifferencesSummary(
  aggregates: ProviderAggregate[],
): string[] {
  const active = aggregates.filter((a) => a.enabled && a.docs > 0);
  const lines: string[] = [];

  if (active.length === 0) {
    return [
      "Aucun provider n’a produit de scores. Vérifiez DocMind (npm run dev) et les clés API cloud.",
    ];
  }

  const bestQuality = [...active].sort((a, b) => b.quality - a.quality)[0];
  const lowestHallu = [...active].sort(
    (a, b) => a.hallucinationRate - b.hallucinationRate,
  )[0];
  const bestCite = [...active].sort((a, b) => b.citationRate - a.citationRate)[0];
  const fastest = [...active].sort(
    (a, b) => a.avgDurationMs - b.avgDurationMs,
  )[0];
  const bestOcr = [...active].sort((a, b) => b.ocrRecall - a.ocrRecall)[0];

  lines.push(
    `Qualité globale : ${bestQuality.label} en tête (${pct(bestQuality.quality)}).`,
  );
  lines.push(
    `Hallucinations (extras vs golden) : ${lowestHallu.label} le plus fiable (${pct(lowestHallu.hallucinationRate)} d’extras).`,
  );
  lines.push(
    `Citations ancrées dans le texte : ${bestCite.label} (${pct(bestCite.citationRate)}).`,
  );
  lines.push(
    `Vitesse moyenne : ${fastest.label} (${ms(fastest.avgDurationMs)}).`,
  );
  lines.push(
    `OCR / extraction structurée (montants, dates, parties) : ${bestOcr.label} (${pct(bestOcr.ocrRecall)} recall).`,
  );

  for (const suite of ["contrat", "facture", "courrier"] as const) {
    const ranked = active
      .filter((a) => a.bySuite[suite].docs > 0)
      .sort((a, b) => b.bySuite[suite].quality - a.bySuite[suite].quality);
    if (ranked[0]) {
      lines.push(
        `${suiteLabel(suite)} : ${ranked[0].label} (${pct(ranked[0].bySuite[suite].quality)})` +
          (ranked[1]
            ? ` devant ${ranked[1].label} (${pct(ranked[1].bySuite[suite].quality)})`
            : "") +
          ".",
      );
    }
  }

  const docmind = active.find((a) => a.provider === "docmind");
  if (docmind) {
    lines.push(
      "DocMind : pipeline local (privacy), citations vérifiées côté serveur, pas de dépendance API cloud pour l’inférence.",
    );
  }

  const skipped = aggregates.filter((a) => !a.enabled);
  if (skipped.length > 0) {
    lines.push(
      `Providers non exécutés : ${skipped.map((s) => `${s.label} (${s.skipReason})`).join(" · ")}.`,
    );
  }

  // Différences produit (au-delà du score)
  lines.push(
    "Différences produit : ChatGPT/Claude/Gemini excellents en rédaction libre ; DocMind optimise l’ancrage factuel (verify + citations) et le parcours métier FR (quotas, mémoire, alertes). Mistral Le Chat est évalué via API texte (pas l’UX web upload).",
  );

  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function writeBenchmarkHtmlReport(
  result: BenchmarkRunResult,
  reportDir: string,
): Promise<{ htmlPath: string; jsonPath: string }> {
  await mkdir(reportDir, { recursive: true });
  const stamp = result.runId;
  const htmlPath = path.join(reportDir, `benchmark-${stamp}.html`);
  const latestPath = path.join(reportDir, "benchmark-latest.html");
  const jsonPath = path.join(reportDir, `benchmark-${stamp}.json`);
  const latestJson = path.join(reportDir, "benchmark-latest.json");

  const rows = result.aggregates
    .map((a) => {
      if (!a.enabled) {
        return `<tr class="skip"><td>${escapeHtml(a.label)}</td><td colspan="8">${escapeHtml(a.skipReason || "skip")}</td></tr>`;
      }
      return `<tr>
        <td><strong>${escapeHtml(a.label)}</strong><br/><span class="muted">${escapeHtml(a.model)}</span></td>
        <td>${pct(a.quality)}</td>
        <td>${pct(a.hallucinationRate)}</td>
        <td>${pct(a.citationRate)}</td>
        <td>${ms(a.avgDurationMs)}</td>
        <td>${pct(a.ocrRecall)}</td>
        <td>${pct(a.bySuite.contrat.quality)}</td>
        <td>${pct(a.bySuite.facture.quality)}</td>
        <td>${pct(a.bySuite.courrier.quality)}</td>
      </tr>`;
    })
    .join("\n");

  const diffs = result.differencesSummary
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>Benchmark DocMind — ${escapeHtml(stamp)}</title>
  <style>
    :root { --bg:#0f1419; --card:#1a222c; --text:#e7eef7; --muted:#8b9bb0; --accent:#2bb8c5; --border:#2a3542; }
    body { font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem; }
    h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
    .muted { color: var(--muted); font-size: .85rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; margin: 1.25rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { border-bottom: 1px solid var(--border); padding: .65rem .5rem; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
    tr.skip td { color: var(--muted); font-style: italic; }
    ul { line-height: 1.55; padding-left: 1.2rem; }
    .accent { color: var(--accent); }
  </style>
</head>
<body>
  <h1>Benchmark DocMind</h1>
  <p class="muted">Run ${escapeHtml(stamp)} · ${result.docs.length} document(s) · comparé à ChatGPT, Claude, Gemini, Mistral Le Chat</p>

  <div class="card">
    <h2>Scores agrégés</h2>
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Qualité</th>
          <th>Hallucinations ↓</th>
          <th>Citations</th>
          <th>Vitesse</th>
          <th>OCR recall</th>
          <th>Contrat</th>
          <th>Facture</th>
          <th>Courrier</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="muted">Hallucinations = part d’items « en trop » vs golden. Citations = extraits ancrables dans le texte. OCR = recall montants/dates/personnes/orgs.</p>
  </div>

  <div class="card">
    <h2 class="accent">Résumé des différences</h2>
    <ul>${diffs}</ul>
  </div>

  <div class="card">
    <h2>Méthode</h2>
    <ul>
      <li>Ground truth : <code>test-documents/**/*_expected.json</code></li>
      <li>Scoring : <code>compareAnalysis</code> (F1 lexical + embeddings sémantiques)</li>
      <li>DocMind : upload PDF + analyse locale Ollama</li>
      <li>Cloud : JSON forcé ; PDF natif si API le permet, sinon texte extrait</li>
      <li>Providers sans clé API : skippés (voir .env)</li>
    </ul>
  </div>
</body>
</html>`;

  await writeFile(htmlPath, html, "utf8");
  await writeFile(latestPath, html, "utf8");
  const json = JSON.stringify(result, null, 2);
  await writeFile(jsonPath, json, "utf8");
  await writeFile(latestJson, json, "utf8");

  return { htmlPath, jsonPath };
}

export function providerLabel(id: BenchmarkProviderId): string {
  return PROVIDER_LABELS[id];
}

export function allProviderMeta() {
  return [
    { id: "docmind" as const, label: PROVIDER_LABELS.docmind },
    ...CLOUD_PROVIDERS.map((c) => ({ id: c.id, label: c.label })),
  ];
}
