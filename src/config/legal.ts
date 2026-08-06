/** Infos légales exposées via env (pages publiques). */
export function legalContactEmail(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() ||
    "contact@docmind.app"
  );
}

export function legalEntityName(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME?.trim() ||
    "DocMind (éditeur à compléter)"
  );
}

export function legalAddress(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() ||
    "Adresse de l’éditeur à compléter avant mise en production"
  );
}
