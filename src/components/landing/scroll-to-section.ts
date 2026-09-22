/** Scroll landing sans écrire de hash dans l’URL. */

const HEADER_OFFSET_PX = 72;

export function scrollToLandingSection(sectionId: string): void {
  if (typeof window === "undefined") return;

  if (sectionId === "top") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const el = document.getElementById(sectionId);
  if (!el) return;

  const top =
    el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET_PX;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/** Retire #… de la barre d’adresse sans recharger. */
export function clearLandingHashFromUrl(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

/**
 * Ancien lien /#faq → scroll vers la section puis URL propre (/).
 */
export function consumeLandingHashOnLoad(): void {
  if (typeof window === "undefined") return;
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return;
  // Laisser le layout sticky se peindre avant de scroller.
  requestAnimationFrame(() => {
    scrollToLandingSection(raw);
    clearLandingHashFromUrl();
  });
}
