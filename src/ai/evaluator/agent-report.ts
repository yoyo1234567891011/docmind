import { mkdir, writeFile } from "fs/promises";
import path from "path";

import {
  AGENT_EVAL_STEPS,
  type AgentEvalId,
  type AgentStepEval,
  type DocumentEvalResult,
} from "@/types/eval";
import { averageAgentScoresById } from "@/ai/evaluator/agent-scores";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
}

function scoreClass(score: number): string {
  if (score >= 0.85) return "good";
  if (score >= 0.45) return "mid";
  return "bad";
}

function agentCard(agent: AgentStepEval): string {
  const fields =
    agent.fieldScores.length === 0
      ? `<p class="muted">Pas de champ ground-truth — score de cohérence interne.</p>`
      : `<table class="mini">
          <thead><tr><th>Champ</th><th>Statut</th><th>Score</th><th>Détail</th></tr></thead>
          <tbody>
            ${agent.fieldScores
              .map(
                (f) => `
              <tr>
                <td><code>${escapeHtml(f.field)}</code></td>
                <td>${statusBadge(f.status)}</td>
                <td>${(f.score * 100).toFixed(0)}%</td>
                <td>${escapeHtml(f.detail)}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  const notes =
    agent.notes.length === 0
      ? ""
      : `<ul class="notes">${agent.notes
          .map((n) => `<li>${escapeHtml(n)}</li>`)
          .join("")}</ul>`;

  return `
    <article class="agent ${scoreClass(agent.score)}">
      <header>
        <h3>${escapeHtml(agent.label)}</h3>
        <div class="agent-score">${(agent.score * 100).toFixed(0)}%</div>
      </header>
      <p>${statusBadge(agent.status)} <span class="muted">${escapeHtml(agent.detail)}</span></p>
      ${fields}
      ${notes}
    </article>`;
}

/**
 * Rapport HTML détaillé : un score par agent, pour chaque document.
 */
export async function writeAgentHtmlReport(
  results: DocumentEvalResult[],
  outputPath: string,
): Promise<void> {
  const successful = results.filter((r) => r.success && r.agents?.length);
  const agentAverages = averageAgentScoresById(results);
  const globalAgentScore =
    successful.length === 0
      ? 0
      : successful.reduce((s, r) => s + (r.agentScore ?? 0), 0) /
        successful.length;

  const summaryAgents = AGENT_EVAL_STEPS.map((step) => {
    const avg = agentAverages[step.id as AgentEvalId] ?? 0;
    return `
      <div class="stat ${scoreClass(avg)}">
        <span class="muted">${escapeHtml(step.label)}</span>
        <strong>${(avg * 100).toFixed(1)}%</strong>
      </div>`;
  }).join("");

  const docs = results
    .map((result) => {
      if (!result.success || !result.agents?.length) {
        return `
        <section class="card fail-card">
          <header>
            <div>
              <h2>${escapeHtml(result.fileName)}</h2>
              <p class="muted">${escapeHtml(result.relativePath)}</p>
            </div>
            <div class="score fail">ÉCHEC</div>
          </header>
          <p class="error">${escapeHtml(result.error || "Analyse impossible")}</p>
        </section>`;
      }

      const agentsHtml = result.agents.map(agentCard).join("");

      return `
      <section class="card">
        <header>
          <div>
            <h2>${escapeHtml(result.fileName)}</h2>
            <p class="muted">${escapeHtml(result.relativePath)} · ${escapeHtml(result.category)} · ${(result.durationMs / 1000).toFixed(1)}s</p>
          </div>
          <div class="scores-side">
            <div class="score">${((result.agentScore ?? 0) * 100).toFixed(1)}%<span class="muted-label">agents</span></div>
            <div class="score secondary">${(result.score * 100).toFixed(1)}%<span class="muted-label">champs</span></div>
          </div>
        </header>
        <div class="agent-grid">
          ${agentsHtml}
        </div>
      </section>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Évaluation par agent — DocMind</title>
  <style>
    :root {
      --bg: #eef3f0;
      --surface: #fff;
      --text: #12201b;
      --muted: #5c6d66;
      --accent: #0f6b5c;
      --warn: #9a6700;
      --danger: #b42318;
      --border: #d3dfd9;
      --good: #dff5ea;
      --mid: #fff6d6;
      --bad: #fde2e1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(900px 400px at 10% -10%, #d9ebe4, transparent),
        linear-gradient(180deg, #f5f8f6, #e7eeea);
      padding: 28px 18px 72px;
    }
    main { max-width: 1220px; margin: 0 auto; }
    h1 { font-size: 1.9rem; margin: 0 0 6px; }
    h2 { font-size: 1.15rem; margin: 0; }
    h3 { font-size: 0.98rem; margin: 0; }
    .muted { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin: 22px 0 28px;
    }
    .stat, .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px 16px;
    }
    .stat strong { display: block; font-size: 1.45rem; margin-top: 4px; }
    .stat.good strong { color: var(--accent); }
    .stat.mid strong { color: var(--warn); }
    .stat.bad strong { color: var(--danger); }
    .card { margin-bottom: 16px; }
    .card header {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      margin-bottom: 14px;
    }
    .scores-side { text-align: right; }
    .score {
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--accent);
      line-height: 1.1;
    }
    .score.secondary { font-size: 1.05rem; color: var(--muted); margin-top: 4px; }
    .score.fail { color: var(--danger); }
    .muted-label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .agent {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: #fbfcfb;
    }
    .agent.good { background: linear-gradient(180deg, var(--good), #fff); }
    .agent.mid { background: linear-gradient(180deg, var(--mid), #fff); }
    .agent.bad { background: linear-gradient(180deg, var(--bad), #fff); }
    .agent header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
      gap: 8px;
    }
    .agent-score { font-size: 1.25rem; font-weight: 700; }
    .mini { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px; }
    .mini th, .mini td {
      border-top: 1px solid var(--border);
      padding: 6px 4px;
      text-align: left;
      vertical-align: top;
    }
    .notes { margin: 8px 0 0; padding-left: 16px; font-size: 0.82rem; color: var(--muted); }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-correct { background: #dff5ea; color: #0f6b5c; }
    .badge-partial { background: #fff3cd; color: #8a6d00; }
    .badge-error { background: #fde2e1; color: #b42318; }
    .badge-omission { background: #e8eef2; color: #355066; }
    .error { color: var(--danger); }
    code { font-size: 0.8rem; }
  </style>
</head>
<body>
  <main>
    <h1>Évaluation par agent</h1>
    <p class="muted">
      Généré le ${escapeHtml(new Date().toLocaleString("fr-FR"))} ·
      Classification · Extraction · Analyse juridique · Risques · Score · Actions · Vérification
    </p>

    <div class="summary">
      <div class="stat ${scoreClass(globalAgentScore)}">
        <span class="muted">Score agents global</span>
        <strong>${(globalAgentScore * 100).toFixed(1)}%</strong>
      </div>
      <div class="stat">
        <span class="muted">Documents</span>
        <strong>${results.length}</strong>
      </div>
      <div class="stat">
        <span class="muted">Succès</span>
        <strong>${successful.length}</strong>
      </div>
      ${summaryAgents}
    </div>

    ${docs}
  </main>
</body>
</html>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
}
