/** Types de courriers que l’agent peut rédiger. */
export type LetterType =
  | "resiliation"
  | "remboursement"
  | "contestation"
  | "reponse_administrative"
  | "autre";

export interface ReadyReply {
  required: boolean;
  reason: string;
  subject: string;
  body: string;
  /** Type de courrier rédigé */
  letterType?: LetterType;
  /** Destinataire (organisation / service) */
  recipient?: string;
  /** Faits extraits réellement utilisés dans le courrier */
  factsUsed?: string[];
}

export const EMPTY_READY_REPLY: ReadyReply = {
  required: false,
  reason: "Aucune réponse n'est nécessaire pour ce document.",
  subject: "",
  body: "",
  letterType: undefined,
  recipient: "",
  factsUsed: [],
};

export const LETTER_TYPES: LetterType[] = [
  "resiliation",
  "remboursement",
  "contestation",
  "reponse_administrative",
  "autre",
];

export const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  resiliation: "Résiliation",
  remboursement: "Demande de remboursement",
  contestation: "Contestation",
  reponse_administrative: "Réponse administrative",
  autre: "Autre courrier",
};

export interface LetterTypeSuggestion {
  letterType: LetterType;
  reason: string;
  confidence: number;
}
