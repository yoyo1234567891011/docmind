import { DEFAULT_LEGAL_CONTACT_EMAIL } from "@/config/domains";

/** Infos légales exposées via env (pages publiques). */
export function legalContactEmail(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() ||
    DEFAULT_LEGAL_CONTACT_EMAIL
  );
}

export function legalEntityName(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME?.trim() ||
    "Échélia (éditeur à compléter)"
  );
}

export function legalAddress(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() ||
    "[Adresse à compléter]"
  );
}

/** SIRET si renseigné ; sinon placeholder explicite (ne pas inventer). */
export function legalSiret(): string {
  return (
    process.env.NEXT_PUBLIC_LEGAL_SIRET?.trim() ||
    "[SIRET à compléter]"
  );
}
