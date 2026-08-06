import { writeFile } from "fs/promises";
import path from "path";

import type { InfraProbeSummary, LoadSimulationReport, LevelMetrics } from "./types";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)} %`;
}

function satPill(level: LevelMetrics): string {
  return level.saturation.saturated
    ? `<span class="pill danger">SATURÉ</span>`
    : `<span class="pill ok">OK</span>`;
}

function infraCell(s: InfraProbeSummary): string {
  if (!s.configured) return `<span class="muted">N/C</span>`;
  return `${fmtMs(s.p50Ms)} <span class="muted">p95 ${fmtMs(s.p95Ms)}</span>`;
}

function levelRows(levels: LevelMetrics[]): string {
  return levels
    .map(
      (l) => `
    <tr class="${l.saturation.saturated ? "row-danger" : ""}">
      <td><strong>${l.concurrentUsers}</strong></td>
      <td><code>${esc(String(l.mode))}</code></td>
      <td>${satPill(l)}</td>
      <td>${fmtMs(l.p50TotalMs)} / ${fmtMs(l.p95TotalMs)} / ${fmtMs(l.p99TotalMs)}</td>
      <td>${fmtMs(l.p50P2Ms)} / ${fmtMs(l.p95P2Ms)} / ${fmtMs(l.p99P2Ms)}</td>
      <td>${fmtMs(l.p50QueueWaitMs)} <span class="muted">max ${fmtMs(l.maxQueueWaitMs)}</span></td>
      <td>${l.avgQueueLength.toFixed(1)} / ${l.maxQueueLength}</td>
      <td>${pct(l.timeoutRate)} <span class="muted">(n=${l.timeoutCount})</span></td>
      <td>${l.system.avgCpuPercent ?? "—"}% / ${l.system.maxCpuPercent ?? "—"}%</td>
      <td>${l.system.avgRamPercent != null ? l.system.avgRamPercent.toFixed(1) : "—"}% / ${l.system.maxRamPercent != null ? l.system.maxRamPercent.toFixed(1) : "—"}%</td>
      <td>${l.system.avgGpuPercent ?? "—"}% / ${l.system.maxGpuPercent ?? "—"}%</td>
      <td>${infraCell(l.infra.redis)}</td>
      <td>${infraCell(l.infra.postgres)}</td>
      <td>${infraCell(l.infra.s3)}</td>
      <td>${pct(l.cache.hitRate)}</td>
    </tr>`,
    )
    .join("\n");
}

function chartPayload(levels: LevelMetrics[]) {
  const labels = levels.map((l) => String(l.concurrentUsers));
  const num = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;

  return {
    labels,
    latency: {
      p50: levels.map((l) => num(l.p50TotalMs)),
      p95: levels.map((l) => num(l.p95TotalMs)),
      p99: levels.map((l) => num(l.p99TotalMs)),
    },
    p2: {
      p50: levels.map((l) => num(l.p50P2Ms)),
      p95: levels.map((l) => num(l.p95P2Ms)),
      p99: levels.map((l) => num(l.p99P2Ms)),
    },
    queue: {
      waitP50: levels.map((l) => num(l.p50QueueWaitMs)),
      waitP95: levels.map((l) => num(l.p95QueueWaitMs)),
      waitP99: levels.map((l) => num(l.p99QueueWaitMs)),
      lengthMax: levels.map((l) => num(l.maxQueueLength)),
    },
    host: {
      cpu: levels.map((l) => num(l.system.avgCpuPercent)),
      ram: levels.map((l) => num(l.system.avgRamPercent)),
      gpu: levels.map((l) => num(l.system.avgGpuPercent)),
    },
    infra: {
      redis: levels.map((l) => num(l.infra.redis.p50Ms)),
      postgres: levels.map((l) => num(l.infra.postgres.p50Ms)),
      s3: levels.map((l) => num(l.infra.s3.p50Ms)),
    },
    timeout: levels.map((l) => num(l.timeoutRate * 100)),
    cache: levels.map((l) => num(l.cache.hitRate * 100)),
  };
}

export async function writeLoadHtmlReport(
  report: LoadSimulationReport,
  outPath: string,
): Promise<void> {
  const cal = report.calibration
    ? `<p>Calibration P2 = <strong>${fmtMs(report.calibration.serviceTimeP2Ms)}</strong>
       · P1 = <strong>${fmtMs(report.calibration.serviceTimeP1Ms)}</strong>
       · débit ≈ <strong>${report.calibration.throughputPerHour.toFixed(1)} docs/h</strong></p>`
    : `<p class="muted">Pas de calibration live — hypothèses modèle par défaut (~175 s P2).</p>`;

  const dataJson = JSON.stringify(chartPayload(report.levels));

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>DocMind — Test de charge</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #fff;
      --ink: #142033;
      --muted: #5a6578;
      --line: #d8dee8;
      --ok: #0f7b4c;
      --danger: #b42318;
      --warn: #9a6700;
      --accent: #1f4e79;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.45;
    }
    header {
      background: linear-gradient(120deg, #102a43, #1f4e79);
      color: #fff;
      padding: 2rem 1.5rem 1.5rem;
    }
    header h1 { margin: 0 0 .4rem; font-size: 1.75rem; }
    header p { margin: .25rem 0; opacity: .9; }
    main { max-width: 1280px; margin: 0 auto; padding: 1.5rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1.1rem 1.2rem;
      margin-bottom: 1rem;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 1rem;
    }
    .chart-box { position: relative; height: 280px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: .82rem;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }
    th, td { padding: .55rem .45rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eef2f7; font-size: .7rem; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
    tr.row-danger { background: #fff5f5; }
    .pill {
      display: inline-block;
      padding: .1rem .45rem;
      border-radius: 999px;
      font-size: .72rem;
      font-weight: 700;
    }
    .pill.ok { background: #e3f6ec; color: var(--ok); }
    .pill.danger { background: #fde8e6; color: var(--danger); }
    .muted { color: var(--muted); font-size: .85rem; }
    .callout {
      border-left: 4px solid var(--warn);
      background: #fff8e8;
      padding: .9rem 1rem;
      border-radius: 0 10px 10px 0;
      margin: 1rem 0;
    }
    footer { padding: 1rem 1.5rem 2rem; color: var(--muted); font-size: .8rem; text-align: center; }
    code { background: #eef2f7; padding: .05rem .3rem; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>Test de charge DocMind</h1>
    <p>Généré le ${esc(report.generatedAt)}</p>
    <p>Mode : <strong>${esc(report.options.mode)}</strong> · Auth : <strong>${esc(report.options.auth)}</strong> · Base : <strong>${esc(report.options.baseUrl)}</strong></p>
    <p>Niveaux : ${report.options.usersLevels.join(", ")} users · ${report.options.docsPerUser} doc(s)/user</p>
  </header>
  <main>
    <section class="card">
      <h2>Calibration</h2>
      ${cal}
      <div class="callout"><strong>Conclusion</strong><br/>${esc(report.conclusion)}</div>
    </section>

    <section class="card">
      <h2>Graphiques</h2>
      <div class="charts">
        <div class="card" style="margin:0">
          <h3>Latence parcours — P50 / P95 / P99</h3>
          <div class="chart-box"><canvas id="chartLatency"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Latence P2 — P50 / P95 / P99</h3>
          <div class="chart-box"><canvas id="chartP2"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>File d’attente (attente ms)</h3>
          <div class="chart-box"><canvas id="chartQueue"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Timeouts (%)</h3>
          <div class="chart-box"><canvas id="chartTimeout"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>CPU / RAM / GPU (%)</h3>
          <div class="chart-box"><canvas id="chartHost"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Redis / Postgres / S3 (p50 ms)</h3>
          <div class="chart-box"><canvas id="chartInfra"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Cache hit rate (%)</h3>
          <div class="chart-box"><canvas id="chartCache"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Longueur max de file</h3>
          <div class="chart-box"><canvas id="chartQLen"></canvas></div>
        </div>
      </div>
    </section>

    <section class="card" style="overflow-x:auto">
      <h2>Tableau synthétique</h2>
      <table>
        <thead>
          <tr>
            <th>Users</th>
            <th>Mode</th>
            <th>Sat.</th>
            <th>Total P50/P95/P99</th>
            <th>P2 P50/P95/P99</th>
            <th>Queue wait</th>
            <th>Queue moy/max</th>
            <th>Timeouts</th>
            <th>CPU moy/max</th>
            <th>RAM moy/max</th>
            <th>GPU moy/max</th>
            <th>Redis</th>
            <th>Postgres</th>
            <th>S3</th>
            <th>Cache</th>
          </tr>
        </thead>
        <tbody>
          ${levelRows(report.levels)}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Méthodologie</h2>
      <ul>
        <li><strong>live</strong> : vrais appels HTTP (upload → analyze → poll P2 → historique).</li>
        <li><strong>model</strong> : file M/D/1 sur le verrou GPU + projection infra.</li>
        <li><strong>hybrid</strong> : calibration live (petit N) puis projection 100→10k.</li>
        <li><strong>P50/P95/P99</strong> : percentiles sur latences mesurées ou simulées.</li>
        <li><strong>CPU/RAM</strong> : OS local pendant live ; null en modèle pur sans probe hôte.</li>
        <li><strong>GPU</strong> : <code>nvidia-smi</code> si dispo.</li>
        <li><strong>Redis / Postgres / S3</strong> : PING / SELECT 1 / HeadBucket (env) + projection sous charge en modèle.</li>
        <li><strong>Cache</strong> : <code>resultSource=cache</code> en live ; modèle fingerprint même PDF.</li>
        <li><strong>Timeout</strong> : budget poll client (défaut 8 min).</li>
      </ul>
    </section>
  </main>
  <footer>DocMind load-test · graphiques Chart.js</footer>
  <script>
    const DATA = ${dataJson};
    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "Utilisateurs simultanés" } },
        y: { beginAtZero: true }
      }
    };
    function line(id, datasets, yTitle) {
      const el = document.getElementById(id);
      if (!el || typeof Chart === "undefined") return;
      new Chart(el, {
        type: "line",
        data: { labels: DATA.labels, datasets },
        options: {
          ...commonOpts,
          scales: {
            ...commonOpts.scales,
            y: { ...commonOpts.scales.y, title: { display: true, text: yTitle } }
          }
        }
      });
    }
    const colors = {
      p50: "#1f4e79",
      p95: "#9a6700",
      p99: "#b42318",
      cpu: "#1f4e79",
      ram: "#0f7b4c",
      gpu: "#7c3aed",
      redis: "#dc2626",
      pg: "#2563eb",
      s3: "#0891b2",
      timeout: "#b42318",
      cache: "#0f7b4c",
      qlen: "#1f4e79"
    };
    line("chartLatency", [
      { label: "P50", data: DATA.latency.p50, borderColor: colors.p50, tension: 0.2 },
      { label: "P95", data: DATA.latency.p95, borderColor: colors.p95, tension: 0.2 },
      { label: "P99", data: DATA.latency.p99, borderColor: colors.p99, tension: 0.2 }
    ], "ms");
    line("chartP2", [
      { label: "P50", data: DATA.p2.p50, borderColor: colors.p50, tension: 0.2 },
      { label: "P95", data: DATA.p2.p95, borderColor: colors.p95, tension: 0.2 },
      { label: "P99", data: DATA.p2.p99, borderColor: colors.p99, tension: 0.2 }
    ], "ms");
    line("chartQueue", [
      { label: "Wait P50", data: DATA.queue.waitP50, borderColor: colors.p50, tension: 0.2 },
      { label: "Wait P95", data: DATA.queue.waitP95, borderColor: colors.p95, tension: 0.2 },
      { label: "Wait P99", data: DATA.queue.waitP99, borderColor: colors.p99, tension: 0.2 }
    ], "ms");
    line("chartTimeout", [
      { label: "Timeout %", data: DATA.timeout, borderColor: colors.timeout, backgroundColor: "rgba(180,35,24,.12)", fill: true, tension: 0.2 }
    ], "%");
    line("chartHost", [
      { label: "CPU moy", data: DATA.host.cpu, borderColor: colors.cpu, tension: 0.2 },
      { label: "RAM moy", data: DATA.host.ram, borderColor: colors.ram, tension: 0.2 },
      { label: "GPU moy", data: DATA.host.gpu, borderColor: colors.gpu, tension: 0.2 }
    ], "%");
    line("chartInfra", [
      { label: "Redis p50", data: DATA.infra.redis, borderColor: colors.redis, tension: 0.2 },
      { label: "Postgres p50", data: DATA.infra.postgres, borderColor: colors.pg, tension: 0.2 },
      { label: "S3 p50", data: DATA.infra.s3, borderColor: colors.s3, tension: 0.2 }
    ], "ms");
    line("chartCache", [
      { label: "Hit rate", data: DATA.cache, borderColor: colors.cache, backgroundColor: "rgba(15,123,76,.12)", fill: true, tension: 0.2 }
    ], "%");
    line("chartQLen", [
      { label: "Queue max", data: DATA.queue.lengthMax, borderColor: colors.qlen, tension: 0.2 }
    ], "jobs");
  </script>
</body>
</html>`;

  await writeFile(outPath, html, "utf8");
  const latest = path.join(path.dirname(outPath), "load-sim-report-latest.html");
  await writeFile(latest, html, "utf8");
}
