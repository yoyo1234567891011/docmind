/**
 * Notification domain — channel-agnostic events derived from document analyses.
 * In-app delivery uses the alerts pipeline; email is prepared via outbox/channels.
 */

export type NotificationKind =
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

export type NotificationChannelId = "in_app" | "email";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  message: string;
  historyId: string;
  documentTitle: string;
  fileName: string;
  evidence: string[];
  dueDate?: string;
  amount?: number;
  createdAt: string;
  read: boolean;
  dismissed: boolean;
  /** Channels this notification is eligible for */
  channels: NotificationChannelId[];
}

export interface NotificationPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailAddress: string | null;
  kinds: Record<NotificationKind, boolean>;
  updatedAt: string;
}

export interface NotificationOutboxItem {
  id: string;
  userId: string;
  channel: NotificationChannelId;
  notificationId: string;
  kind: NotificationKind;
  payload: {
    to?: string | null;
    subject: string;
    body: string;
    historyId: string;
  };
  status: "pending" | "sent" | "failed" | "skipped";
  error?: string;
  createdAt: string;
  processedAt?: string;
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  deadline_soon: "Échéance proche",
  high_risk: "Risque important",
  action_required: "Action à effectuer",
  renewal: "Renouvellement",
  termination: "Résiliation",
  important_payment: "Paiement important",
  analysis_ready: "Analyse complète prête",
  relation_duplicate: "Doublon entre documents",
  relation_supersede: "Remplacement de contrat",
  relation_overlap_risk: "Risque / garantie en double",
  relation_redundant_payment: "Paiement redondant",
  relation_deadline_conflict: "Échéances liées",
  relation_contradiction: "Contradiction entre documents",
};

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<
  NotificationPreferences,
  "updatedAt"
> = {
  inAppEnabled: true,
  emailEnabled: false,
  emailAddress: null,
  kinds: {
    deadline_soon: true,
    high_risk: true,
    action_required: true,
    renewal: true,
    termination: true,
    important_payment: true,
    analysis_ready: true,
    relation_duplicate: true,
    relation_supersede: true,
    relation_overlap_risk: true,
    relation_redundant_payment: true,
    relation_deadline_conflict: true,
    relation_contradiction: true,
  },
};
