/** Simulation financière DocMind — revenus, coûts infra, marge, ROI */

export interface FinanceAssumptions {
  /** Prix Premium € / mois */
  priceMonthlyEur: number;
  /** Part d’utilisateurs Premium (0–1) */
  premiumConversion: number;
  /** Analyses PDF / user / mois */
  analysesPerUserMonth: number;
  /** Minutes GPU moyennes par analyse */
  gpuMinutesPerAnalysis: number;
  /** € / heure GPU (usage) */
  gpuHourEur: number;
  /** Location GPU instance € / mois (si flotte) */
  gpuInstanceMonthlyEur: number;
  /** Users totaux supportés par 1 instance GPU (capacité) */
  usersPerGpuInstance: number;

  redisBaseEur: number;
  redisPer1kUsersEur: number;

  s3GbPerUser: number;
  s3EurPerGb: number;
  s3RequestsPerUserMonth: number;
  s3EurPer1kRequests: number;

  postgresBaseEur: number;
  postgresPer1kUsersEur: number;

  /** Commission Stripe variable (ex. 0.015 UE) */
  stripePercent: number;
  /** Frais fixes Stripe par transaction € */
  stripeFixedEur: number;

  emailsPerUserMonth: number;
  emailCostEur: number;

  /** Charges fixes mensuelles (salaires, outils, etc.) */
  fixedOpexEur: number;
  /** Investissement initial pour ROI */
  initialInvestmentEur: number;
}

export interface CostBreakdown {
  gpuEur: number;
  gpuInstances: number;
  gpuUsageHours: number;
  redisEur: number;
  s3Eur: number;
  postgresEur: number;
  stripeEur: number;
  emailsEur: number;
  emailsCount: number;
  variableEur: number;
  fixedOpexEur: number;
  totalEur: number;
}

export interface FinanceLevel {
  users: number;
  premiumUsers: number;
  freeUsers: number;
  /** Revenu mensuel récurrent */
  mrrEur: number;
  /** Revenu annuel (MRR × 12) */
  arrEur: number;
  /** ARPU tous users */
  arpuEur: number;
  costs: CostBreakdown;
  /** Bénéfice mensuel = MRR − coûts totaux */
  profitMonthlyEur: number;
  /** Bénéfice annuel */
  profitAnnualEur: number;
  /** Marge nette (profit / MRR), null si MRR=0 */
  marginRate: number | null;
  /** Burn rate mensuel (cash brûlé si perte, sinon 0) */
  burnRateMonthlyEur: number;
  /** Point mort : users totaux pour profit ≥ 0 (null si jamais) */
  breakEvenUsers: number | null;
  /** Atteint le point mort à ce niveau ? */
  pastBreakEven: boolean;
  /** ROI annuel = profit annuel / investissement */
  roiAnnualRate: number | null;
  /** Mois pour récupérer l’investissement (si profit > 0) */
  paybackMonths: number | null;
  notes: string[];
}

export interface FinanceReport {
  generatedAt: string;
  assumptions: FinanceAssumptions;
  levels: FinanceLevel[];
  /** Point mort global (même formule pour tous les niveaux) */
  breakEvenUsers: number | null;
  conclusion: string;
}
