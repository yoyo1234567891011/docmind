import { docmindConfig } from "@/config/docmind";

export const ACCEPTED_DOCUMENT_MIME_TYPES =
  docmindConfig.upload.acceptedMimeTypes;

export const MAX_UPLOAD_SIZE_BYTES = docmindConfig.upload.maxSizeBytes;

export const ANALYSIS_JSON_SCHEMA = {
  document_type: "",
  title: "",
  date: "",
  people: [] as string[],
  organizations: [] as string[],
  amounts: [] as string[],
  deadlines: [] as string[],
  important_points: [] as string[],
  risks: [] as string[],
  actions: [] as string[],
  risk_score: 0,
  risk_level: "faible",
  risk_explanation: "",
  risk_criteria: [] as Array<{
    id: string;
    label: string;
    detected: boolean;
    score: number;
    max_score: number;
    reasons: string[];
  }>,
} as const;

export const ANALYSIS_SECTIONS = [
  "document_type",
  "title",
  "date",
  "people",
  "organizations",
  "amounts",
  "deadlines",
  "important_points",
  "risks",
  "actions",
  "risk_score",
  "risk_level",
  "risk_explanation",
  "risk_criteria",
] as const satisfies ReadonlyArray<keyof typeof ANALYSIS_JSON_SCHEMA>;
