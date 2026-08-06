import type {
  CostBreakdown,
  FinanceAssumptions,
  FinanceLevel,
} from "./types";

export function defaultAssumptions(
  overrides: Partial<FinanceAssumptions> = {},
): FinanceAssumptions {
  return {
    priceMonthlyEur: 19,
    premiumConversion: 0.12,
    analysesPerUserMonth: 4,
    gpuMinutesPerAnalysis: 3,
    gpuHourEur: Number(process.env.ANALYTICS_GPU_HOUR_EUR) || 0.12,
    gpuInstanceMonthlyEur: 400,
    // Charge test : saturation ~100 concurrent ; pic ~2–5 % users → ~2–5k/GPU.
    // Conservateur produit : 500 users / GPU worker.
    usersPerGpuInstance: 500,
    redisBaseEur: 15,
    redisPer1kUsersEur: 8,
    s3GbPerUser: 0.08,
    s3EurPerGb: 0.023,
    s3RequestsPerUserMonth: 80,
    s3EurPer1kRequests: 0.005,
    postgresBaseEur: 30,
    postgresPer1kUsersEur: 25,
    stripePercent: 0.015,
    stripeFixedEur: 0.25,
    emailsPerUserMonth: 4,
    emailCostEur: 0.001,
    fixedOpexEur: 8_000,
    initialInvestmentEur: 50_000,
    ...overrides,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stripeFeePerPayment(a: FinanceAssumptions): number {
  return a.priceMonthlyEur * a.stripePercent + a.stripeFixedEur;
}

/** Coût variable par user total (hors Stripe — Stripe sur Premium seulement). */
function variableCostPerUserExStripe(a: FinanceAssumptions): number {
  const gpuHoursPerUser =
    (a.analysesPerUserMonth * a.gpuMinutesPerAnalysis) / 60;
  const gpuUsage = gpuHoursPerUser * a.gpuHourEur;
  // Part flotte GPU amortie par user (approx)
  const gpuFleetShare = a.gpuInstanceMonthlyEur / a.usersPerGpuInstance;

  const redis = a.redisPer1kUsersEur / 1000;
  const s3Storage = a.s3GbPerUser * a.s3EurPerGb;
  const s3Req = (a.s3RequestsPerUserMonth / 1000) * a.s3EurPer1kRequests;
  const pg = a.postgresPer1kUsersEur / 1000;
  const email = a.emailsPerUserMonth * a.emailCostEur;

  // GPU : max(usage, part instance) pour ne pas sous-estimer
  const gpu = Math.max(gpuUsage, gpuFleetShare);
  return gpu + redis + s3Storage + s3Req + pg + email;
}

/**
 * Point mort en users totaux :
 * MRR − stripeFees − varCosts − fixed ≥ 0
 * u * c * P − u * c * stripeFee − u * v − F ≥ 0
 * u * (c*P − c*fee − v) ≥ F
 */
export function computeBreakEvenUsers(a: FinanceAssumptions): number | null {
  const c = a.premiumConversion;
  const contrib =
    c * a.priceMonthlyEur -
    c * stripeFeePerPayment(a) -
    variableCostPerUserExStripe(a);
  // Bases Redis/PG/S3/GPU min. hors per-user : redisBase + postgresBase + 1 GPU
  const fixedInfra =
    a.redisBaseEur + a.postgresBaseEur + a.gpuInstanceMonthlyEur;
  const fixed = a.fixedOpexEur + fixedInfra;
  if (contrib <= 0) return null;
  return Math.ceil(fixed / contrib);
}

export function computeCosts(
  users: number,
  premiumUsers: number,
  a: FinanceAssumptions,
): CostBreakdown {
  const gpuUsageHours =
    (users * a.analysesPerUserMonth * a.gpuMinutesPerAnalysis) / 60;
  const gpuUsageEur = gpuUsageHours * a.gpuHourEur;
  const gpuInstances = Math.max(1, Math.ceil(users / a.usersPerGpuInstance));
  const gpuFleetEur = gpuInstances * a.gpuInstanceMonthlyEur;
  const gpuEur = round2(Math.max(gpuUsageEur, gpuFleetEur));

  const redisEur = round2(
    a.redisBaseEur + (users / 1000) * a.redisPer1kUsersEur,
  );
  const s3Storage = users * a.s3GbPerUser * a.s3EurPerGb;
  const s3Req =
    ((users * a.s3RequestsPerUserMonth) / 1000) * a.s3EurPer1kRequests;
  const s3Eur = round2(s3Storage + s3Req);

  const postgresEur = round2(
    a.postgresBaseEur + (users / 1000) * a.postgresPer1kUsersEur,
  );

  const stripeEur = round2(premiumUsers * stripeFeePerPayment(a));
  const emailsCount = Math.round(users * a.emailsPerUserMonth);
  const emailsEur = round2(emailsCount * a.emailCostEur);

  const variableEur = round2(
    gpuEur + redisEur + s3Eur + postgresEur + stripeEur + emailsEur,
  );
  const totalEur = round2(variableEur + a.fixedOpexEur);

  return {
    gpuEur,
    gpuInstances,
    gpuUsageHours: round2(gpuUsageHours),
    redisEur,
    s3Eur,
    postgresEur,
    stripeEur,
    emailsEur,
    emailsCount,
    variableEur,
    fixedOpexEur: a.fixedOpexEur,
    totalEur,
  };
}

export function simulateLevel(
  users: number,
  a: FinanceAssumptions,
  breakEvenUsers: number | null,
): FinanceLevel {
  const premiumUsers = Math.round(users * a.premiumConversion);
  const freeUsers = users - premiumUsers;
  const mrrEur = round2(premiumUsers * a.priceMonthlyEur);
  const arrEur = round2(mrrEur * 12);
  const arpuEur = users === 0 ? 0 : round2(mrrEur / users);
  const costs = computeCosts(users, premiumUsers, a);
  const profitMonthlyEur = round2(mrrEur - costs.totalEur);
  const profitAnnualEur = round2(profitMonthlyEur * 12);
  const marginRate = mrrEur === 0 ? null : profitMonthlyEur / mrrEur;
  const burnRateMonthlyEur =
    profitMonthlyEur < 0 ? round2(-profitMonthlyEur) : 0;
  const pastBreakEven =
    breakEvenUsers != null ? users >= breakEvenUsers : profitMonthlyEur >= 0;

  let roiAnnualRate: number | null = null;
  let paybackMonths: number | null = null;
  if (a.initialInvestmentEur > 0) {
    roiAnnualRate = profitAnnualEur / a.initialInvestmentEur;
    if (profitMonthlyEur > 0) {
      paybackMonths = Math.ceil(a.initialInvestmentEur / profitMonthlyEur);
    }
  }

  const notes: string[] = [
    `${premiumUsers} Premium (${(a.premiumConversion * 100).toFixed(0)} %) × ${a.priceMonthlyEur} €`,
    `GPU : ${costs.gpuInstances} instance(s), ~${costs.gpuUsageHours} h usage/mois`,
    `${costs.emailsCount} emails/mois`,
  ];
  if (profitMonthlyEur < 0) {
    notes.push(`Burn ${burnRateMonthlyEur} €/mois`);
  } else {
    notes.push(`Bénéfice ${profitMonthlyEur} €/mois · marge ${((marginRate ?? 0) * 100).toFixed(0)} %`);
  }

  return {
    users,
    premiumUsers,
    freeUsers,
    mrrEur,
    arrEur,
    arpuEur,
    costs,
    profitMonthlyEur,
    profitAnnualEur,
    marginRate,
    burnRateMonthlyEur,
    breakEvenUsers,
    pastBreakEven,
    roiAnnualRate,
    paybackMonths,
    notes,
  };
}

export function buildConclusion(
  levels: FinanceLevel[],
  breakEvenUsers: number | null,
  a: FinanceAssumptions,
): string {
  const profitable = levels.filter((l) => l.profitMonthlyEur >= 0);
  const first = profitable[0];
  if (!first) {
    const last = levels[levels.length - 1];
    return (
      `Aucun des niveaux simulés n’est profitable avec les hypothèses actuelles ` +
      `(conversion ${(a.premiumConversion * 100).toFixed(0)} %, prix ${a.priceMonthlyEur} €, ` +
      `opex fixe ${a.fixedOpexEur} €/mois). ` +
      `À ${last?.users ?? "—"} users : burn ${last?.burnRateMonthlyEur ?? "—"} €/mois, ` +
      `point mort estimé ${breakEvenUsers ?? "inatteignable (contribution ≤ 0)"}.`
    );
  }
  const at10k = levels.find((l) => l.users >= 10_000) ?? levels[levels.length - 1];
  return (
    `Point mort ≈ ${breakEvenUsers ?? first.users} utilisateurs totaux ` +
    `(~${Math.round((breakEvenUsers ?? first.users) * a.premiumConversion)} Premium). ` +
    `Rentable dès ${first.users} users dans la grille. ` +
    `À ${at10k.users} users : MRR ${at10k.mrrEur} €, ARR ${at10k.arrEur} €, ` +
    `bénéfice ${at10k.profitMonthlyEur} €/mois, marge ${(((at10k.marginRate ?? 0) * 100)).toFixed(0)} %, ` +
    `ROI annuel ${at10k.roiAnnualRate != null ? `${(at10k.roiAnnualRate * 100).toFixed(0)} %` : "—"}.`
  );
}
