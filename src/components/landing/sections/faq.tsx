"use client";

const FAQ_ITEMS = [
  {
    q: "En quoi DocMind est différent de ChatGPT ?",
    a: "ChatGPT est un chat généraliste où vous collez un PDF. DocMind construit une mémoire (fiches, alertes, recherche, historique) et prépare des actions. L’analyse passe par une API dédiée (Groq), pas par ChatGPT public.",
  },
  {
    q: "Où vont mes documents ?",
    a: "Vous téléversez un PDF : le texte est extrait sur nos serveurs, puis envoyé à Groq (États-Unis) pour l’analyse. DocMind n’utilise pas vos documents pour entraîner un modèle grand public. Consultez aussi la politique de confidentialité de Groq. Compte isolé : pas de partage entre utilisateurs.",
  },
  {
    q: "Quels PDF sont acceptés ?",
    a: "Uniquement les PDF avec texte sélectionnable. Les scans / photos / PDF image ne sont pas supportés pour l’instant (pas d’OCR). Comptez environ 1 à 3 minutes pour une analyse complète. Détails dans le Guide.",
  },
  {
    q: "Dois-je installer un logiciel ?",
    a: "Non. DocMind fonctionne dans le navigateur. Créez un compte, déposez un PDF texte — l’analyse démarre automatiquement.",
  },
  {
    q: "Faut-il une carte bancaire pour commencer ?",
    a: "Non. L’offre Gratuite suffit pour analyser, rechercher et recevoir des alertes. L’agent courrier est inclus dès Basique.",
  },
  {
    q: "Puis-je changer ou annuler mon abonnement facilement ?",
    a: "Oui. Depuis Facturation → portail Stripe : annulation en fin de période déjà payée. Aucun engagement long. Détails dans les CGV.",
  },
  {
    q: "DocMind remplace-t-il un avocat ?",
    a: "Non. C’est un outil d’aide à la lecture et à l’organisation. Les conclusions restent à valider selon votre situation.",
  },
] as const;

export function LandingFaq() {
  return (
    <section
      id="faq"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Questions fréquentes
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Les objections avant de créer un compte — réponses directes.
          </p>
        </div>

        <div className="mt-12 max-w-3xl space-y-2">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.q}
              className="group border-b border-[var(--border)] py-4"
            >
              <summary className="cursor-pointer list-none text-left text-base font-medium text-[var(--foreground)] marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-4">
                  {item.q}
                  <span className="mt-0.5 shrink-0 text-[var(--muted)] transition-transform group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
