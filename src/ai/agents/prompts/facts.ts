export function buildFactsAgentPrompt(documentText: string): string {
  const schema = JSON.stringify({
    date: "",
    dates: [] as string[],
    people: [] as string[],
    organizations: [] as string[],
    amounts: [] as string[],
    deadlines: [] as string[],
    clauses: [] as string[],
  });

  return [
    "Agent extraction de faits. JSON uniquement.",
    "Extrais uniquement ce qui est écrit dans le document. N'invente rien.",
    "people = noms de personnes. organizations = sociétés/organismes.",
    "amounts = « valeur — libellé » (ex. « 1 050 € — Loyer mensuel », « 1 178 € — Montant à prélever »). Inclure périodicité dans le libellé si connue. Prioriser montants dus par l’usager (à payer / à prélever / échéance / pénalités / loyer / charges / dépôt). Déprioriser ou omettre : capital social, garantie financière d’agence, totaux nationaux, statistiques, montants liés à la suppression de la taxe d’habitation, numéros/références formatés en euros, chiffres hors échelle personnelle. Sur avis fiscal (taxe foncière, impôts, prélèvement) : ne retenir que le montant dû / à prélever, pas les montants accessoire hors sujet. Sans libellé sûr → montant seul. deadlines = échéances/délais datés.",
    "clauses = phrases de clauses importantes (recopiées, max 5).",
    "Max 6 items/tableau. date = date principale du document.",
    `Schéma: ${schema}`,
    "<<<DOCUMENT>>>",
    documentText.trim(),
    "<<<FIN>>>",
  ].join("\n");
}
