/**
 * IP client pour rate-limit (proxy-aware).
 * Ne lit X-Forwarded-For / X-Real-Ip que si TRUST_PROXY=1
 * (proxy de confiance configuré explicitement).
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY?.trim() !== "1") {
    return "unknown";
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}
