/**
 * Simulation financière DocMind (MRR, ARR, coûts, marge, burn, point mort, ROI).
 *
 *   npm run finance:sim
 *   npm run finance:sim -- --users 100,500,1000,5000,10000 --conversion 0.15
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  buildConclusion,
  computeBreakEvenUsers,
  defaultAssumptions,
  simulateLevel,
} from "./model";
import { writeFinanceHtmlReport } from "./report-html";
import type { FinanceAssumptions, FinanceReport } from "./types";

const ROOT = process.cwd();
const DEFAULT_USERS = [100, 500, 1000, 5000, 10_000];

function loadEnvFile(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    try {
      loadEnvFile(await readFile(path.join(ROOT, name), "utf8"));
    } catch {
      /* optional */
    }
  }
}

function parseArgs(argv: string[]): {
  users: number[];
  outDir: string;
  overrides: Partial<FinanceAssumptions>;
} {
  const overrides: Partial<FinanceAssumptions> = {};
  let users = DEFAULT_USERS;
  let outDir = path.join(ROOT, "reports");

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--users") {
      users = (next() || "")
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (arg === "--out") outDir = path.resolve(next() || outDir);
    else if (arg === "--price") overrides.priceMonthlyEur = Number(next());
    else if (arg === "--conversion") overrides.premiumConversion = Number(next());
    else if (arg === "--fixed-opex") overrides.fixedOpexEur = Number(next());
    else if (arg === "--investment") overrides.initialInvestmentEur = Number(next());
    else if (arg === "--gpu-instance") overrides.gpuInstanceMonthlyEur = Number(next());
    else if (arg === "--users-per-gpu") overrides.usersPerGpuInstance = Number(next());
    else if (arg === "--analyses") overrides.analysesPerUserMonth = Number(next());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (users.length === 0) users = DEFAULT_USERS;
  return { users, outDir, overrides };
}

function printHelp() {
  console.log(`Simulation financière DocMind

Options:
  --users 100,500,1000,5000,10000
  --price 19
  --conversion 0.12
  --fixed-opex 8000
  --investment 50000
  --gpu-instance 400
  --users-per-gpu 500
  --analyses 4
  --out reports

Calcule: MRR, ARR, GPU, Redis, S3, Postgres, Stripe, emails,
         bénéfice, marge, burn rate, point mort, ROI
`);
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

async function main() {
  await loadEnv();
  const { users, outDir, overrides } = parseArgs(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });

  const assumptions = defaultAssumptions(overrides);
  const breakEvenUsers = computeBreakEvenUsers(assumptions);
  const levels = users
    .slice()
    .sort((a, b) => a - b)
    .map((u) => simulateLevel(u, assumptions, breakEvenUsers));

  const report: FinanceReport = {
    generatedAt: new Date().toISOString(),
    assumptions,
    levels,
    breakEvenUsers,
    conclusion: buildConclusion(levels, breakEvenUsers, assumptions),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const htmlPath = path.join(outDir, `finance-sim-report-${stamp}.html`);
  const jsonPath = path.join(outDir, `finance-sim-report-${stamp}.json`);

  await writeFinanceHtmlReport(report, htmlPath);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(outDir, "finance-sim-report-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("=== DocMind finance simulation ===");
  console.log(
    `users=${users.join(",")} · Premium ${assumptions.priceMonthlyEur}€ · conv ${(assumptions.premiumConversion * 100).toFixed(0)}%`,
  );
  console.log(
    `Point mort ≈ ${breakEvenUsers?.toLocaleString("fr-FR") ?? "inatteignable"} users`,
  );
  console.log(
    "\nUsers | Premium | MRR | ARR | GPU | Redis | S3 | PG | Stripe | Emails | Profit | Marge | Burn | ROI",
  );
  for (const l of levels) {
    console.log(
      [
        String(l.users).padStart(5),
        String(l.premiumUsers).padStart(5),
        fmtEur(l.mrrEur).padStart(10),
        fmtEur(l.arrEur).padStart(10),
        fmtEur(l.costs.gpuEur).padStart(8),
        fmtEur(l.costs.redisEur).padStart(7),
        fmtEur(l.costs.s3Eur).padStart(7),
        fmtEur(l.costs.postgresEur).padStart(7),
        fmtEur(l.costs.stripeEur).padStart(7),
        fmtEur(l.costs.emailsEur).padStart(7),
        fmtEur(l.profitMonthlyEur).padStart(10),
        l.marginRate == null
          ? "—"
          : `${(l.marginRate * 100).toFixed(0)}%`.padStart(5),
        fmtEur(l.burnRateMonthlyEur).padStart(8),
        l.roiAnnualRate == null
          ? "—"
          : `${(l.roiAnnualRate * 100).toFixed(0)}%`,
      ].join(" | "),
    );
  }
  console.log(`\n${report.conclusion}`);
  console.log(`\nRapport HTML : ${htmlPath}`);
  console.log(`Latest : ${path.join(outDir, "finance-sim-report-latest.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
