import type {
  ApiResponse,
  LetterType,
  LetterTypeSuggestion,
  ReadyReply,
} from "@/types";

export interface DraftLetterResponse {
  letter: ReadyReply;
  letterType: LetterType;
  suggestionReason: string;
  source: "llm" | "fallback";
  historyId: string;
}

export async function draftLetter(input: {
  historyId: string;
  letterType?: LetterType | "auto";
  persist?: boolean;
}): Promise<DraftLetterResponse> {
  const response = await fetch("/api/letters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as ApiResponse<DraftLetterResponse>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

export async function fetchLetterSuggestion(historyId: string): Promise<{
  historyId: string;
  suggestion: LetterTypeSuggestion;
  currentLetter: ReadyReply | null;
  premiumRequired?: boolean;
  canGenerate?: boolean;
  analyzeQuota?: {
    used: number;
    limit: number;
    remaining: number | null;
  } | null;
}> {
  const response = await fetch(
    `/api/letters?historyId=${encodeURIComponent(historyId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as ApiResponse<{
    historyId: string;
    suggestion: LetterTypeSuggestion;
    currentLetter: ReadyReply | null;
    premiumRequired?: boolean;
    canGenerate?: boolean;
    analyzeQuota?: {
      used: number;
      limit: number;
      remaining: number | null;
    } | null;
  }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}
