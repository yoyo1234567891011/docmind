/** Constantes CSRF safe pour le bundle client (pas de crypto Node). */
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_COOKIE_NAME = "docmind_csrf";

export function csrfHeaderName(): string {
  return CSRF_HEADER_NAME;
}

export function csrfCookieName(): string {
  return CSRF_COOKIE_NAME;
}
