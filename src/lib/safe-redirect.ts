/**
 * Valide un paramètre `next` post-login / OAuth.
 * Autorise uniquement un chemin relatif same-origin sûr.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (value.includes("://")) return fallback;
  if (/[\r\n\t\0]/.test(value)) return fallback;
  // Refuse protocol-relative and scheme-like paths: /%2f…, /\evil
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("://")) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
