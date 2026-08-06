/**
 * SimHash 64-bit déterministe (Charikar) — near-duplicate sans LLM.
 */

function fnv1a32(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Features = unigrams + bigrams (poids 1). */
function features(text: string): string[] {
  const tokens = tokenize(text);
  const out: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return out;
}

/**
 * Calcule un SimHash 64-bit, retourné en hex (16 chars).
 */
export function computeSimhash(text: string): string {
  const bits = new Array<number>(64).fill(0);
  const feats = features(text.slice(0, 200_000));
  if (feats.length === 0) return "0".repeat(16);

  for (const feat of feats) {
    const h1 = fnv1a32(feat);
    const h2 = fnv1a32(`:${feat}`);
    // Combine en 64 bits
    for (let i = 0; i < 32; i++) {
      bits[i] += (h1 >>> i) & 1 ? 1 : -1;
      bits[i + 32] += (h2 >>> i) & 1 ? 1 : -1;
    }
  }

  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 32; i++) {
    if (bits[i]! >= 0) lo |= 1 << i;
    if (bits[i + 32]! >= 0) hi |= 1 << i;
  }
  const hex =
    (hi >>> 0).toString(16).padStart(8, "0") +
    (lo >>> 0).toString(16).padStart(8, "0");
  return hex;
}

export function hammingDistanceHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i += 8) {
    const x = Number.parseInt(a.slice(i, i + 8), 16) >>> 0;
    const y = Number.parseInt(b.slice(i, i + 8), 16) >>> 0;
    let v = x ^ y;
    while (v) {
      v &= v - 1;
      dist += 1;
    }
  }
  return dist;
}

/** 4 bandes de 16 bits pour LSH (lookup O(band hits), pas O(N)). */
export function simhashBands(simhash: string): string[] {
  const h = simhash.padStart(16, "0").slice(0, 16);
  return [h.slice(0, 4), h.slice(4, 8), h.slice(8, 12), h.slice(12, 16)].map(
    (b, i) => `b${i}:${b}`,
  );
}
