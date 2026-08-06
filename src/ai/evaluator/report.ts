import { mkdir, writeFile } from "fs/promises";
import path from "path";

import type {
  DocumentEvalResult,
  EvalField,
  FieldComparison,
  SemanticDiff,
} from "@/types/eval";
import { AGENT_EVAL_STEPS, EVAL_FIELDS, SEMANTIC_FIELDS } from "@/types/eval";
import { averageAgentScoresById } from "@/ai/evaluator/agent-scores";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatList(items: string[]): string {
  if (items.length === 0) return "<em>Aucun</em>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
}

function modeBadge(mode?: string): string {
  if (!mode) return "";
  return `<span class="mode mode-${escapeHtml(mode)}">${escapeHtml(mode)}</span>`;
}

function formatDiff(diff: SemanticDiff): string {
  const sim =
    diff.similarity > 0
      ? `<span class="sim">${Math.round(diff.similarity * 100)}%</span>`
      : "";

  if (diff.kind === "equivalent" || diff.kind === "partial" || diff.kind === "divergent") {
    return `
      <div class="diff diff-${diff.kind}">
        <div class="diff-head">
          <span class="badge badge-${diff.kind === "equivalent" ? "correct" : diff.kind === "partial" ? "partial" : "error"}">${diff.kind}</span>
          ${sim}
        </div>
        <p class="note">${escapeHtml(diff.note)}</p>
        <div class="diff-grid">
          <div><strong>Attendu</strong><p>${escapeHtml(diff.expected ?? "—")}</p></div>
          <div><strong>Prédit</strong><p>${escapeHtml(diff.predicted ?? "—")}</p></div>
        </div>
      </div>`;
  }

  if (diff.kind === "missing") {
    return `
      <div class="diff diff-missing">
        <div class="diff-head">
          <span class="badge badge-omission">missing</span>
        </div>
        <p class="note">${escapeHtml(diff.note)}</p>
        <p><strong>Attendu non couvert :</strong> ${escapeHtml(diff.expected ?? "")}</p>
      </div>`;
  }

  return `
    <div class="diff diff-extra">
      <div class="diff-head">
        <span class="badge badge-error">extra</span>
      </div>
      <p class="note">${escapeHtml(diff.note)}</p>
      <p><strong>Ajout réel :</strong> ${escapeHtml(diff.predicted ?? "")}</p>
    </div>`;
}

function formatRealDifferences(field: FieldComparison): string {
  if (!field.diffs || field.diffs.length === 0) {
    return field.mode === "semantic"
      ? "<em>Aucune différence réelle</em>"
      : "<em>—</em>";
  }

  const realDiffs = field.diffs.filter((diff) => diff.kind !== "equivalent");
  if (realDiffs.length === 0) {
    return "<em>Sens équivalent — aucune différence réelle</em>";
  }

  return realDiffs.map(formatDiff).join("");
}

function computeFieldScores(
  results: DocumentEvalResult[],
): Record<EvalField, number> {
  const averages = {} as Record<EvalField, number>;

  for (const field of EVAL_FIELDS) {
    const scores = results
      .filter((result) => result.success)
      .map((result) => result.fields.find((item) => item.field === field)?.score)
      .filter((score): score is number => typeof score === "number");

    averages[field] =
      scores.length === 0
        ? 0
        : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  return averages;
}

export async function writeHtmlReport(
  results: DocumentEvalResult[],
  outputPath: string,
  options?: { fieldScores?: Record<EvalField, number> },
): Promise<void> {
  const successful = results.filter((result) => result.success);
  const globalScore =
    successful.length === 0
      ? 0
      : successful.reduce((sum, result) => sum + result.score, 0) /
        successful.length;
  const fieldScores = options?.fieldScores ?? computeFieldScores(results);
  const agentScores = averageAgentScoresById(results);
  const hasAgents = successful.some((r) => (r.agents?.length ?? 0) > 0);

  const totalCorrect = successful.reduce(
    (sum, result) =>
      sum + result.fields.filter((field) => field.status === "correct").length,
    0,
  );
  const totalPartial = successful.reduce(
    (sum, result) =>
      sum + result.fields.filter((field) => field.status === "partial").length,
    0,
  );
  const totalErrors = successful.reduce(
    (sum, result) =>
      sum + result.fields.filter((field) => field.status === "error").length,
    0,
  );
  const totalOmissions = successful.reduce(
    (sum, result) =>
      sum + result.fields.filter((field) => field.status === "omission").length,
    0,
  );

  const semanticRealDiffCount = successful.reduce((sum, result) => {
    return (
      sum +
      result.fields.reduce((fieldSum, field) => {
        if (field.mode !== "semantic" || !field.diffs) return fieldSum;
        return (
          fieldSum + field.diffs.filter((diff) => diff.kind !== "equivalent").length
        );
      }, 0)
    );
  }, 0);

  const fieldScoreRows = EVAL_FIELDS.map((field) => {
    const semantic = SEMANTIC_FIELDS.includes(
      field as (typeof SEMANTIC_FIELDS)[number],
    );
    return `
      <tr>
        <td><code>${escapeHtml(field)}</code>${semantic ? ' <span class="mode mode-semantic">sémantique</span>' : ""}</td>
        <td><strong>${(fieldScores[field] * 100).toFixed(1)}%</strong></td>
      </tr>`;
  }).join("");

  const rows = results
    .map((result) => {
      const fieldRows = result.fields
        .map(
          (field) => `
            <tr>
              <td>
                <code>${escapeHtml(field.field)}</code>
                ${modeBadge(field.mode)}
              </td>
              <td>${statusBadge(field.status)}</td>
              <td>${(field.score * 100).toFixed(0)}%</td>
              <td>${escapeHtml(field.detail)}</td>
              <td class="diffs">${formatRealDifferences(field)}</td>
              <td>${formatList(field.correctItems)}</td>
              <td>${formatList(field.errors)}</td>
              <td>${formatList(field.omissions)}</td>
            </tr>`,
        )
        .join("");

      const semanticDiffs = result.fields
        .filter((field) => field.mode === "semantic" && field.diffs?.length)
        .flatMap((field) =>
          (field.diffs ?? [])
            .filter((diff) => diff.kind !== "equivalent")
            .map((diff) => ({ field: field.field, diff })),
        );

      const semanticSection =
        semanticDiffs.length === 0
          ? `<p class="muted">Champs sémantiques : aucune différence réelle détectée.</p>`
          : `
          <h3>Différences réelles (sémantique)</h3>
          ${semanticDiffs
            .map(
              ({ field, diff }) => `
              <div class="semantic-block">
                <code>${escapeHtml(field)}</code>
                ${formatDiff(diff)}
              </div>`,
            )
            .join("")}`;

      return `
      <section class="card">
        <header>
          <div>
            <h2>${escapeHtml(result.fileName)}</h2>
            <p class="muted">${escapeHtml(result.relativePath)} · ${escapeHtml(result.category)}</p>
          </div>
          <div class="score ${result.success ? "" : "fail"}">
            ${result.success ? `${(result.score * 100).toFixed(1)}%` : "ÉCHEC"}
            ${
              result.success && result.agentScore != null
                ? `<div style="font-size:0.75rem;font-weight:600;color:var(--muted);margin-top:4px">agents ${(result.agentScore * 100).toFixed(0)}%</div>`
                : ""
            }
          </div>
        </header>
        ${
          result.error
            ? `<p class="error">${escapeHtml(result.error)}</p>`
            : `
          <p class="muted">Durée ${(result.durationMs / 1000).toFixed(1)}s</p>
          ${
            result.agents?.length
              ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:12px 0 16px">
                  ${result.agents
                    .map(
                      (a) => `<div style="border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:#fafcfb">
                        <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase">${escapeHtml(a.label)}</div>
                        <div style="font-weight:700;font-size:1.1rem">${(a.score * 100).toFixed(0)}%</div>
                        ${statusBadge(a.status)}
                      </div>`,
                    )
                    .join("")}
                </div>`
              : ""
          }
          ${
            result.promptsUsed?.length
              ? `<p class="muted"><strong>Prompts :</strong> ${result.promptsUsed
                  .map(
                    (p) =>
                      `${escapeHtml(p.key)}=${escapeHtml(
                        p.source === "admin" && p.version != null
                          ? `v${p.version} (${p.label})`
                          : p.label,
                      )}`,
                  )
                  .join(" · ")}</p>`
              : ""
          }
          ${semanticSection}
          <table>
            <thead>
              <tr>
                <th>Champ</th>
                <th>Statut</th>
                <th>Score</th>
                <th>Détail</th>
                <th>Différences réelles</th>
                <th>Correct</th>
                <th>Erreurs</th>
                <th>Oublis</th>
              </tr>
            </thead>
            <tbody>${fieldRows}</tbody>
          </table>`
        }
      </section>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rapport d'évaluation DocMind</title>
  <style>
    :root {
      --bg: #f3f6f4;
      --surface: #ffffff;
      --text: #14201c;
      --muted: #5b6b64;
      --accent: #0f6b5c;
      --danger: #b42318;
      --border: #d5e0db;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #f3f6f4, #e7eeea);
      color: var(--text);
      padding: 32px 20px 64px;
    }
    main { max-width: 1180px; margin: 0 auto; }
    h1 { font-size: 2rem; margin: 0 0 8px; }
    h2 { font-size: 1.15rem; margin: 0; }
    h3 { font-size: 1rem; margin: 18px 0 10px; }
    .muted { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0 32px;
    }
    .stat, .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 18px;
    }
    .stat strong { display: block; font-size: 1.6rem; margin-top: 6px; }
    .card { margin-bottom: 18px; }
    .card header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: start;
      margin-bottom: 12px;
    }
    .score {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }
    .score.fail { color: var(--danger); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th, td {
      border-top: 1px solid var(--border);
      padding: 10px 8px;
      vertical-align: top;
      text-align: left;
    }
    th { color: var(--muted); font-weight: 600; }
    ul { margin: 0; padding-left: 18px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-correct { background: #dff5ea; color: #0f6b5c; }
    .badge-partial { background: #fff3cd; color: #8a6d00; }
    .badge-error { background: #fde2e1; color: #b42318; }
    .badge-omission { background: #e8eef2; color: #355066; }
    .mode {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 6px;
      font-size: 0.7rem;
      background: #eef2f0;
      color: var(--muted);
      text-transform: uppercase;
    }
    .mode-semantic { background: #e4f0ff; color: #1d4f91; }
    .diff {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      margin: 0 0 8px;
      background: #fafcfb;
    }
    .diff-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .diff-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .diff-grid p, .diff p { margin: 4px 0 0; }
    .note { color: var(--muted); font-size: 0.85rem; }
    .sim { font-weight: 700; color: var(--accent); }
    .semantic-block { margin-bottom: 10px; }
    .error { color: var(--danger); }
    code { font-size: 0.85rem; }
    @media (max-width: 800px) {
      .diff-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Rapport d'évaluation DocMind</h1>
    <p class="muted">Généré le ${escapeHtml(new Date().toLocaleString("fr-FR"))} · comparaison sémantique pour summary / important_points / risks / actions</p>

    <div class="summary">
      <div class="stat"><span class="muted">Score global</span><strong>${(globalScore * 100).toFixed(1)}%</strong></div>
      <div class="stat"><span class="muted">Documents</span><strong>${results.length}</strong></div>
      <div class="stat"><span class="muted">Succès analyse</span><strong>${successful.length}</strong></div>
      <div class="stat"><span class="muted">Champs corrects</span><strong>${totalCorrect}</strong></div>
      <div class="stat"><span class="muted">Partiels</span><strong>${totalPartial}</strong></div>
      <div class="stat"><span class="muted">Erreurs</span><strong>${totalErrors}</strong></div>
      <div class="stat"><span class="muted">Oublis</span><strong>${totalOmissions}</strong></div>
      <div class="stat"><span class="muted">Différences réelles</span><strong>${semanticRealDiffCount}</strong></div>
    </div>

    ${(() => {
      const sample = successful.find((r) => r.promptsUsed?.length)?.promptsUsed;
      if (!sample?.length) return "";
      return `
    <section class="card">
      <header>
        <div>
          <h2>Prompts utilisés (run)</h2>
          <p class="muted">Versions actives au moment de l'évaluation</p>
        </div>
      </header>
      <ul>
        ${sample
          .map(
            (p) =>
              `<li><code>${escapeHtml(p.key)}</code> — ${escapeHtml(
                p.source === "admin" && p.version != null
                  ? `v${p.version} · ${p.label}`
                  : p.label,
              )} <span class="muted">(${escapeHtml(p.source)})</span></li>`,
          )
          .join("")}
      </ul>
    </section>`;
    })()}

    ${
      hasAgents
        ? `<section class="card">
      <header>
        <div>
          <h2>Scores par agent</h2>
          <p class="muted">Moyenne sur les analyses réussies — voir aussi eval-agents-report-latest.html</p>
        </div>
      </header>
      <table>
        <thead><tr><th>Agent</th><th>Score</th></tr></thead>
        <tbody>
          ${AGENT_EVAL_STEPS.map(
            (step) => `
            <tr>
              <td>${escapeHtml(step.label)}</td>
              <td><strong>${((agentScores[step.id] ?? 0) * 100).toFixed(1)}%</strong></td>
            </tr>`,
          ).join("")}
        </tbody>
      </table>
    </section>`
        : ""
    }

    <section class="card">
      <header>
        <div>
          <h2>Scores par champ</h2>
          <p class="muted">Moyenne sur les analyses réussies</p>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>${fieldScoreRows}</tbody>
      </table>
    </section>

    ${rows}
  </main>
</body>
</html>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
}
