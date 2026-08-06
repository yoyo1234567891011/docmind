"use client";

const FAQ_ITEMS = [
  {
    q: "En quoi DocMind est différent de ChatGPT ?",
    a: "ChatGPT est un chat généraliste : vous y collez un PDF, vous obtenez un texte. DocMind construit une mémoire (fiches, alertes, recherche, historique) et prépare des actions — sans envoyer vos documents à une IA cloud grand public.",
  },
  {
    q: "Mes documents quittent-ils mon ordinateur ?",
    a: "L’analyse LLM s’exécute via votre instance Ollama locale. Les fichiers restent dans votre espace DocMind, isolé par compte — pas dans un chat ChatGPT.",
  },
  {
    q: "Dois-je installer Ollama ?",
    a: "Oui, pour l’analyse IA locale. Sans Ollama, DocMind ne peut pas générer l’analyse. L’installation est gratuite ; une fois lancé, vous déposez simplement vos PDF.",
  },
  {
    q: "Faut-il une carte bancaire pour commencer ?",
    a: "Non. L’offre Gratuite suffit pour analyser, rechercher et recevoir des alertes. Premium est optionnel (courriers IA).",
  },
  {
    q: "Puis-je annuler Premium facilement ?",
    a: "Oui. Vous gérez l’abonnement depuis Facturation ; l’annulation en fin de période est prévue. Aucun engagement long.",
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
