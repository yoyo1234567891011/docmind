/**
 * Domaines publics Échélia.
 * En code & env techniques : forme ASCII (punycode) — Stripe, CSRF, Resend, scripts.
 * Affichage humain : forme Unicode (échélia.com / .fr).
 */

export const PRIMARY_DOMAIN_UNICODE = "échélia.com";
export const PRIMARY_DOMAIN_ASCII = "xn--chlia-9rac.com";

export const ALT_DOMAIN_UNICODE = "échélia.fr";
export const ALT_DOMAIN_ASCII = "xn--chlia-9rac.fr";

/** URL canonique production (ASCII — fiable partout). */
export const PRIMARY_APP_URL = `https://${PRIMARY_DOMAIN_ASCII}`;

/** Alias marketing / Vercel secondaire. */
export const ALT_APP_URL = `https://${ALT_DOMAIN_ASCII}`;

/** Expéditeur Resend par défaut (domaine vérifié chez Resend). */
export const DEFAULT_RESEND_FROM_EMAIL = `Échélia <notifications@${PRIMARY_DOMAIN_UNICODE}>`;

/** Contact légal par défaut. */
export const DEFAULT_LEGAL_CONTACT_EMAIL = `contact@${PRIMARY_DOMAIN_UNICODE}`;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Toutes les origines HTTPS autorisées (Unicode + ASCII, .com + .fr). */
export function knownProductionOrigins(): string[] {
  const list = [
    PRIMARY_APP_URL,
    ALT_APP_URL,
    `https://${PRIMARY_DOMAIN_UNICODE}`,
    `https://${ALT_DOMAIN_UNICODE}`,
  ];
  const out = new Set<string>();
  for (const raw of list) {
    const origin = originOf(raw);
    if (origin) out.add(origin);
  }
  return [...out];
}

/**
 * Base URL publique pour scripts / fallbacks.
 * Préfère NEXT_PUBLIC_APP_URL puis PROD_BASE_URL puis domaine principal.
 */
export function resolvePublicAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromApp = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromApp) return fromApp;
  const fromProd = env.PROD_BASE_URL?.trim().replace(/\/$/, "");
  if (fromProd) return fromProd;
  const fromSmoke = env.SMOKE_BASE_URL?.trim().replace(/\/$/, "");
  if (fromSmoke) return fromSmoke;
  return PRIMARY_APP_URL;
}
