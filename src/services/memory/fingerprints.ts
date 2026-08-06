import { contentHashFromText } from "@/services/memory/normalize";
import { computeSimhash } from "@/services/memory/simhash";

export interface TextFingerprints {
  contentHash: string;
  simhash: string;
}

/** Fingerprints texte — à appeler dès l’extraction. */
export function computeTextFingerprints(text: string): TextFingerprints {
  const normalized = text.trim();
  return {
    contentHash: contentHashFromText(normalized),
    simhash: computeSimhash(normalized),
  };
}
