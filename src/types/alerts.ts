export type AlertKind =
  | "deadline_soon"
  | "high_risk"
  | "action_required"
  | "renewal"
  | "termination"
  | "important_payment"
  | "analysis_ready"
  | "relation_duplicate"
  | "relation_supersede"
  | "relation_overlap_risk"
  | "relation_redundant_payment"
  | "relation_deadline_conflict"
  | "relation_contradiction";



export type AlertSeverity = "info" | "warning" | "critical";



/** Priorité affichée / tri (plus critique = plus urgent). */

export type AlertPriority = "critique" | "haute" | "moyenne" | "basse";



export interface DocumentAlert {

  id: string;

  kind: AlertKind;

  severity: AlertSeverity;

  /** Priorité métier dérivée (échéance, risque, paiement…). */

  priority: AlertPriority;

  title: string;

  message: string;

  historyId: string;

  documentTitle: string;

  fileName: string;

  /** Related raw evidence from the document analysis */

  evidence: string[];

  /**

   * Date de l’alerte (échéance concernée, sinon date de détection).

   * Format YYYY-MM-DD.

   */

  date: string;

  /** Alias explicite pour les échéances (même valeur que date si applicable). */

  dueDate?: string;

  amount?: number;

  /** Action recommandée à effectuer. */

  recommendedAction: string;

  createdAt: string;

  read: boolean;

  dismissed: boolean;

  /** Arête mémoire à l’origine (alertes relationnelles P3). */
  relationId?: string | null;

  /** Historique du document pair pour navigation bilatérale. */
  secondaryHistoryId?: string | null;

}



export interface AlertsSummary {

  total: number;

  unread: number;

  byKind: Record<AlertKind, number>;

  bySeverity: Record<AlertSeverity, number>;

  byPriority: Record<AlertPriority, number>;

}



export interface AlertsListResult {

  alerts: DocumentAlert[];

  summary: AlertsSummary;

  generatedAt: string;

}



export interface AlertsStateFile {
  readIds: string[];
  dismissedIds: string[];
  /** Alertes ponctuelles (ex. analyse P2 prête) — non dérivées du detect. */
  pinnedAlerts?: DocumentAlert[];
  updatedAt: string;
}

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  deadline_soon: "Échéance",
  high_risk: "Risque important",
  action_required: "Action à effectuer",
  renewal: "Renouvellement",
  termination: "Résiliation",
  important_payment: "Paiement",
  analysis_ready: "Analyse complète",
  relation_duplicate: "Doublon (relation)",
  relation_supersede: "Remplacement (relation)",
  relation_overlap_risk: "Risque / garantie en double",
  relation_redundant_payment: "Paiement redondant",
  relation_deadline_conflict: "Échéances liées",
  relation_contradiction: "Contradiction (relation)",
};



export const ALERT_PRIORITY_LABELS: Record<AlertPriority, string> = {

  critique: "Critique",

  haute: "Haute",

  moyenne: "Moyenne",

  basse: "Basse",

};



/** Defaults — tunable without rewriting detectors */

export const ALERT_DEFAULTS = {

  deadlineHorizonDays: 60,

  importantPaymentThreshold: 500,

  criticalPaymentThreshold: 2000,

  criticalDeadlineDays: 7,

  warningDeadlineDays: 21,

  highRiskScoreThreshold: 60,

} as const;


