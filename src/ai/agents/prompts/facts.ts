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
    "amounts = montants avec devise si possible. deadlines = échéances/délais datés.",
    "clauses = phrases de clauses importantes (recopiées, max 5).",
    "Max 6 items/tableau. date = date principale du document.",
    `Schéma: ${schema}`,
    "<<<DOCUMENT>>>",
    documentText.trim(),
    "<<<FIN>>>",
  ].join("\n");
}
