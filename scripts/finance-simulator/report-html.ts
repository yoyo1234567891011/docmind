import { writeFile } from "fs/promises";
import path from "path";

import type { FinanceReport } from "./types";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n)
  );
}

function pct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)} %`;
}

export async function writeFinanceHtmlReport(
  report: FinanceReport,
  outPath: string,
): Promise<void> {
  const a = report.assumptions;
  const levels = report.levels;

  const chartData = {
    labels: levels.map((l) => String(l.users)),
    mrr: levels.map((l) => l.mrrEur),
    arr: levels.map((l) => l.arrEur),
    profit: levels.map((l) => l.profitMonthlyEur),
    burn: levels.map((l) => l.burnRateMonthlyEur),
    margin: levels.map((l) =>
      l.marginRate == null ? null : Math.round(l.marginRate * 1000) / 10,
    ),
    roi: levels.map((l) =>
      l.roiAnnualRate == null
        ? null
        : Math.round(l.roiAnnualRate * 1000) / 10,
    ),
    costs: {
      gpu: levels.map((l) => l.costs.gpuEur),
      redis: levels.map((l) => l.costs.redisEur),
      s3: levels.map((l) => l.costs.s3Eur),
      postgres: levels.map((l) => l.costs.postgresEur),
      stripe: levels.map((l) => l.costs.stripeEur),
      emails: levels.map((l) => l.costs.emailsEur),
      fixed: levels.map((l) => l.costs.fixedOpexEur),
      total: levels.map((l) => l.costs.totalEur),
    },
  };

  const rows = levels
    .map(
      (l) => `
    <tr class="${l.pastBreakEven ? "row-ok" : "row-warn"}">
      <td><strong>${l.users.toLocaleString("fr-FR")}</strong></td>
      <td>${l.premiumUsers.toLocaleString("fr-FR")}</td>
      <td>${eur(l.mrrEur)}</td>
      <td>${eur(l.arrEur)}</td>
      <td>${eur(l.costs.gpuEur)} <span class="muted">×${l.costs.gpuInstances}</span></td>
      <td>${eur(l.costs.redisEur)}</td>
      <td>${eur(l.costs.s3Eur)}</td>
      <td>${eur(l.costs.postgresEur)}</td>
      <td>${eur(l.costs.stripeEur)}</td>
      <td>${eur(l.costs.emailsEur)} <span class="muted">${l.costs.emailsCount.toLocaleString("fr-FR")}</span></td>
      <td>${eur(l.profitMonthlyEur)}</td>
      <td>${pct(l.marginRate)}</td>
      <td>${eur(l.burnRateMonthlyEur)}</td>
      <td>${l.breakEvenUsers?.toLocaleString("fr-FR") ?? "—"}</td>
      <td>${pct(l.roiAnnualRate)}</td>
    </tr>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>DocMind — Simulation financière</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #f3f5f8;
      --card: #fff;
      --ink: #122033;
      --muted: #5a6578;
      --line: #d5dbe6;
      --ok: #0f7b4c;
      --warn: #9a6700;
      --danger: #b42318;
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
      background: linear-gradient(125deg, #0f2740, #1f4e79 55%, #2a6f97);
      color: #fff;
      padding: 2rem 1.5rem 1.5rem;
    }
    header h1 { margin: 0 0 .35rem; font-size: 1.7rem; }
    header p { margin: .2rem 0; opacity: .92; }
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
      font-size: .8rem;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }
    th, td {
      padding: .5rem .4rem;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }
    th {
      background: #eef2f7;
      font-size: .68rem;
      text-transform: uppercase;
      letter-spacing: .03em;
      color: var(--muted);
    }
    tr.row-ok { background: #f3fbf6; }
    tr.row-warn { background: #fffaf0; }
    .muted { color: var(--muted); font-size: .78rem; }
    .callout {
      border-left: 4px solid var(--accent);
      background: #eef5fb;
      padding: .9rem 1rem;
      border-radius: 0 10px 10px 0;
    }
    .assumptions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: .6rem;
      font-size: .88rem;
    }
    .assumptions span { display: block; color: var(--muted); font-size: .72rem; }
    footer { text-align: center; color: var(--muted); font-size: .8rem; padding: 1rem 0 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Simulation financière DocMind</h1>
    <p>Généré le ${esc(report.generatedAt)}</p>
    <p>Niveaux : ${levels.map((l) => l.users).join(" · ")} utilisateurs</p>
    <p>Point mort ≈ <strong>${report.breakEvenUsers?.toLocaleString("fr-FR") ?? "—"}</strong> users</p>
  </header>
  <main>
    <section class="card">
      <h2>Conclusion</h2>
      <div class="callout">${esc(report.conclusion)}</div>
    </section>

    <section class="card">
      <h2>Hypothèses</h2>
      <div class="assumptions">
        <div><span>Prix Premium</span><strong>${a.priceMonthlyEur} €/mois</strong></div>
        <div><span>Conversion Premium</span><strong>${(a.premiumConversion * 100).toFixed(0)} %</strong></div>
        <div><span>Analyses / user / mois</span><strong>${a.analysesPerUserMonth}</strong></div>
        <div><span>GPU €/h · instance</span><strong>${a.gpuHourEur} € · ${a.gpuInstanceMonthlyEur} €</strong></div>
        <div><span>Users / GPU</span><strong>${a.usersPerGpuInstance}</strong></div>
        <div><span>Opex fixe</span><strong>${eur(a.fixedOpexEur)}/mois</strong></div>
        <div><span>Investissement (ROI)</span><strong>${eur(a.initialInvestmentEur)}</strong></div>
        <div><span>Stripe</span><strong>${(a.stripePercent * 100).toFixed(1)} % + ${a.stripeFixedEur} €</strong></div>
        <div><span>Emails</span><strong>${a.emailsPerUserMonth}/user · ${a.emailCostEur} €</strong></div>
      </div>
    </section>

    <section class="card">
      <h2>Graphiques</h2>
      <div class="charts">
        <div class="card" style="margin:0">
          <h3>MRR / ARR</h3>
          <div class="chart-box"><canvas id="chartRevenue"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Bénéfice vs burn (mensuel)</h3>
          <div class="chart-box"><canvas id="chartProfit"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Coûts infra (mensuel)</h3>
          <div class="chart-box"><canvas id="chartCosts"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Marge % · ROI annuel %</h3>
          <div class="chart-box"><canvas id="chartRoi"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Stripe · Emails</h3>
          <div class="chart-box"><canvas id="chartOps"></canvas></div>
        </div>
        <div class="card" style="margin:0">
          <h3>Coût total vs MRR</h3>
          <div class="chart-box"><canvas id="chartTotal"></canvas></div>
        </div>
      </div>
    </section>

    <section class="card" style="overflow-x:auto">
      <h2>Tableau par niveau</h2>
      <table>
        <thead>
          <tr>
            <th>Users</th>
            <th>Premium</th>
            <th>MRR</th>
            <th>ARR</th>
            <th>GPU</th>
            <th>Redis</th>
            <th>S3</th>
            <th>Postgres</th>
            <th>Stripe</th>
            <th>Emails</th>
            <th>Bénéfice</th>
            <th>Marge</th>
            <th>Burn</th>
            <th>Point mort</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Méthodologie</h2>
      <ul>
        <li><strong>MRR</strong> = Premium × ${a.priceMonthlyEur} € · <strong>ARR</strong> = MRR × 12</li>
        <li><strong>GPU</strong> = max(usage analyses × €/h, flotte instances × €/mois)</li>
        <li><strong>Redis / Postgres</strong> = base + palier / 1k users</li>
        <li><strong>S3</strong> = stockage Go/user + requêtes</li>
        <li><strong>Stripe</strong> = ${(a.stripePercent * 100).toFixed(1)} % + ${a.stripeFixedEur} € par paiement Premium</li>
        <li><strong>Emails</strong> = volume × coût unitaire</li>
        <li><strong>Bénéfice</strong> = MRR − (infra + Stripe + emails + opex fixe)</li>
        <li><strong>Burn</strong> = perte mensuelle si bénéfice &lt; 0, sinon 0</li>
        <li><strong>Point mort</strong> = users où contribution couvre opex fixe + infra de base</li>
        <li><strong>ROI</strong> = bénéfice annuel / investissement initial</li>
      </ul>
      <p class="muted">Simulation indicative — pas une prévision comptable. Ajuster via CLI / env.</p>
    </section>
  </main>
  <footer>DocMind finance-simulator · Chart.js</footer>
  <script>
    const DATA = ${JSON.stringify(chartData)};
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "Utilisateurs" } },
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
          ...base,
          scales: {
            ...base.scales,
            y: { ...base.scales.y, title: { display: true, text: yTitle } }
          }
        }
      });
    }
    function barStacked(id, datasets, yTitle) {
      const el = document.getElementById(id);
      if (!el || typeof Chart === "undefined") return;
      new Chart(el, {
        type: "bar",
        data: { labels: DATA.labels, datasets },
        options: {
          ...base,
          scales: {
            x: { stacked: true, title: { display: true, text: "Utilisateurs" } },
            y: { stacked: true, beginAtZero: true, title: { display: true, text: yTitle } }
          }
        }
      });
    }
    line("chartRevenue", [
      { label: "MRR", data: DATA.mrr, borderColor: "#1f4e79", tension: 0.2 },
      { label: "ARR", data: DATA.arr, borderColor: "#0f7b4c", tension: 0.2 }
    ], "€");
    line("chartProfit", [
      { label: "Bénéfice", data: DATA.profit, borderColor: "#0f7b4c", tension: 0.2 },
      { label: "Burn", data: DATA.burn, borderColor: "#b42318", tension: 0.2 }
    ], "€ / mois");
    barStacked("chartCosts", [
      { label: "GPU", data: DATA.costs.gpu, backgroundColor: "#7c3aed" },
      { label: "Redis", data: DATA.costs.redis, backgroundColor: "#dc2626" },
      { label: "S3", data: DATA.costs.s3, backgroundColor: "#0891b2" },
      { label: "Postgres", data: DATA.costs.postgres, backgroundColor: "#2563eb" },
      { label: "Stripe", data: DATA.costs.stripe, backgroundColor: "#635bff" },
      { label: "Emails", data: DATA.costs.emails, backgroundColor: "#ca8a04" },
      { label: "Opex fixe", data: DATA.costs.fixed, backgroundColor: "#64748b" }
    ], "€ / mois");
    line("chartRoi", [
      { label: "Marge %", data: DATA.margin, borderColor: "#1f4e79", tension: 0.2 },
      { label: "ROI annuel %", data: DATA.roi, borderColor: "#0f7b4c", tension: 0.2 }
    ], "%");
    line("chartOps", [
      { label: "Stripe", data: DATA.costs.stripe, borderColor: "#635bff", tension: 0.2 },
      { label: "Emails", data: DATA.costs.emails, borderColor: "#ca8a04", tension: 0.2 }
    ], "€ / mois");
    line("chartTotal", [
      { label: "MRR", data: DATA.mrr, borderColor: "#0f7b4c", tension: 0.2 },
      { label: "Coût total", data: DATA.costs.total, borderColor: "#b42318", tension: 0.2 }
    ], "€ / mois");
  </script>
</body>
</html>`;

  await writeFile(outPath, html, "utf8");
  await writeFile(
    path.join(path.dirname(outPath), "finance-sim-report-latest.html"),
    html,
    "utf8",
  );
}
