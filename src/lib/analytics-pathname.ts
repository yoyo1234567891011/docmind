/**
 * Pathname sûr pour analytics — pas de query (tokens), pas de PII.
 */
export function sanitizeAnalyticsPathname(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/";
  let path = raw.trim();
  const q = path.indexOf("?");
  if (q >= 0) path = path.slice(0, q);
  const h = path.indexOf("#");
  if (h >= 0) path = path.slice(0, h);
  if (!path.startsWith("/")) path = `/${path}`;
  // Normalise segments dynamiques trop longs (ids) pour limiter cardinalité
  path = path
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^[0-9a-f-]{20,}$/i.test(seg)) return ":id";
      if (seg.length > 64) return ":id";
      return seg;
    })
    .join("/");
  return path.slice(0, 120) || "/";
}
