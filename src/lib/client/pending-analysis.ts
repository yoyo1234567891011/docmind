/** Persistance légère pour reprendre le polling après refresh (onglet). */

const STORAGE_KEY = "docmind:pending-analysis";

export type PendingAnalysisRef = {
  historyId: string;
  jobId?: string;
  documentId?: string;
  fileName?: string;
};

export function savePendingAnalysis(ref: PendingAnalysisRef): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
  } catch {
    // private mode / quota
  }
}

export function clearPendingAnalysis(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function readPendingAnalysis(): PendingAnalysisRef | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAnalysisRef;
    if (!parsed?.historyId || typeof parsed.historyId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
