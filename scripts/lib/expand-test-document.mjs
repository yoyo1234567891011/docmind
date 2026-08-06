/**
 * Allonge un document de test court en version multi-pages réaliste.
 */

function seededHelpers(rng, utils) {
  const { person, pastDate, futureDate, dateFr, euro, randomAmount, pick } =
    utils;
  return { person, pastDate, futureDate, dateFr, euro, randomAmount, pick, rng };
}

const CATEGORY_HINTS = {
  assurances:
    "Le présent avenant et ses annexes forment un ensemble indivisible avec les conditions particulières et le tableau de garanties.",
  banques:
    "Le titulaire reconnaît avoir reçu l'information précontractuelle et les conditions tarifaires en vigueur à la date d'édition du relevé.",
  impots:
    "Toute contestation doit être motivée et accompagnée des pièces justificatives auprès du service des impôts des particuliers.",
  caf: "Les droits sont calculés sous réserve de la sincérité des déclarations et des contrôles a posteriori.",
  mutuelles:
    "Les prestations sont versées après réception des décomptes et dans la limite des plafonds annuels de la grille de garanties.",
  "contrats-de-travail":
    "Le présent contrat est régi par le Code du travail et, le cas échéant, par la convention collective applicable à l'entreprise.",
  "baux-de-location":
    "Le bail est soumis à la loi du 6 juillet 1989 (logement) et aux dispositions locales applicables à la zone du bien.",
  "factures-edf":
    "La facturation repose sur les index relevés ou estimés et peut faire l'objet d'une régularisation ultérieure.",
  "factures-orange":
    "Les services sont facturés selon l'offre souscrite, hors options hors forfait et taxes applicables.",
  "factures-free":
    "Les services sont facturés selon l'offre souscrite, hors options hors forfait et taxes applicables.",
  "factures-sfr":
    "Les services sont facturés selon l'offre souscrite, hors options hors forfait et taxes applicables.",
  "contrats-internet":
    "L'accès au service dépend de l'éligibilité technique du logement et peut nécessiter l'intervention d'un technicien.",
  "contrats-telephoniques":
    "Le forfait mobile inclut les services décrits ; les usages hors forfait sont facturés au tarif en vigueur.",
  "courriers-administratifs":
    "Le destinataire dispose des voies de recours administratives et contentieuses rappelées en fin de courrier.",
  "relances-de-paiement":
    "À défaut de règlement dans les délais, le créancier se réserve d'engager toute mesure de recouvrement utile.",
  "conditions-generales-de-vente":
    "Les présentes CGV prévalent sur tout autre document commercial non expressément accepté par écrit.",
  devis:
    "Le devis est valable pour la durée indiquée ; passé ce délai, les prix et délais pourront être révisés.",
  "contrats-de-pret":
    "L'emprunteur dispose du délai de réflexion légal avant acceptation définitive de l'offre de prêt.",
};

export function expandToRealisticDocument(body, rng, categoryId, utils) {
  const { person, pastDate, futureDate, dateFr, euro, randomAmount, pick } =
    seededHelpers(rng, utils);

  const footer = [
    "",
    "---",
    "",
    "*Document fictif généré uniquement à des fins de test DocMind. Aucune valeur juridique. Ne reproduit aucun document réel protégé.*",
  ].join("\n");

  const stripped = body
    .replace(/\n---\n[\s\S]*Document fictif[\s\S]*$/i, "")
    .trimEnd();

  const agent = person(rng);
  const witness = person(rng);
  const advisor = person(rng);
  const phone = `0${2 + Math.floor(rng() * 7)}${String(Math.floor(10000000 + rng() * 89999999))}`;
  const email = `contact.${Math.floor(rng() * 9000 + 1000)}@exemple-fictif.fr`;
  const siret = `${Math.floor(10000000000000 + rng() * 89999999999999)}`;
  const iban = `FR76 ${Math.floor(1000 + rng() * 8999)} ${Math.floor(1000 + rng() * 8999)} ${Math.floor(1000 + rng() * 8999)} ${Math.floor(1000 + rng() * 8999)} ${Math.floor(100 + rng() * 899)}`;
  const d1 = pastDate(rng, 2025);
  const d2 = pastDate(rng, 2025);
  const d3 = pastDate(rng, 2026);
  const d4 = futureDate(rng, 2026);
  const d5 = futureDate(rng, 2026);
  const amt1 = euro(randomAmount(rng, 12, 180));
  const amt2 = euro(randomAmount(rng, 40, 420));
  const amt3 = euro(randomAmount(rng, 80, 980), 0);

  const scheduleRows = Array.from({ length: 10 }, (_, idx) => {
    const month = 1 + ((idx + Math.floor(rng() * 3)) % 12);
    const day = 1 + Math.floor(rng() * 27);
    const amount = euro(randomAmount(rng, 25, 650));
    return `| ${dateFr(2026, month, day)} | Échéance n°${idx + 1} | ${amount} | ${pick(rng, ["Prélèvement", "Virement", "Carte", "Chèque"])} |`;
  }).join("\n");

  const historyRows = Array.from({ length: 8 }, (_, idx) => {
    const when = pastDate(rng, 2025 + Math.floor(idx / 4));
    const events = [
      "Ouverture du dossier / création du contrat",
      "Envoi d'un courrier d'information",
      "Modification des coordonnées bancaires",
      "Relance amiable par e-mail",
      "Appel téléphonique du service client",
      "Mise à jour des garanties / options",
      "Réclamation enregistrée puis clôturée",
      "Envoi d'un relevé / avis de situation",
    ];
    return `| ${when} | ${events[idx % events.length]} | ${pick(rng, ["Terminé", "En cours", "Archivé"])} |`;
  }).join("\n");

  const clauseRows = Array.from({ length: 12 }, (_, idx) => {
    const texts = [
      `Clause ${idx + 1}.1 — Information préalable : le destinataire reconnaît avoir reçu les informations essentielles avant engagement.`,
      `Clause ${idx + 1}.2 — Exactitude des déclarations : toute omission intentionnelle peut entraîner la nullité ou la déchéance de garantie.`,
      `Clause ${idx + 1}.3 — Révision : les conditions peuvent être adaptées en cas d'évolution légale, tarifaire ou technique justifiée.`,
      `Clause ${idx + 1}.4 — Preuve : les enregistrements informatiques de l'émetteur font foi jusqu'à preuve contraire.`,
      `Clause ${idx + 1}.5 — Cession : le présent engagement n'est pas cessible sans accord écrit préalable.`,
      `Clause ${idx + 1}.6 — Nullité partielle : si une disposition est jugée invalide, les autres demeurent applicables.`,
    ];
    return `- ${texts[idx % texts.length]}`;
  }).join("\n");

  const specificNote =
    CATEGORY_HINTS[categoryId] ||
    "Les parties reconnaissent avoir pris connaissance de l'ensemble des dispositions du présent document.";

  const expansion = `

## 1. Préambule et identification

Le présent document constitue un acte écrit établi à des fins d'information, de contractualisation ou de suivi administratif. Il doit être lu dans son intégralité, y compris ses annexes et tableaux.

**Références internes (fictives)**
- Identifiant dossier : DOS-${Math.floor(100000 + rng() * 899999)}
- Identifiant pièce : PIE-${Math.floor(100000 + rng() * 899999)}
- SIRET émetteur (fictif) : ${siret}
- Téléphone service : ${phone}
- E-mail service : ${email}
- Conseiller / interlocuteur : ${advisor.fullName}
- IBAN de règlement (fictif) : ${iban}

${specificNote}

Le destinataire est invité à vérifier chaque montant, chaque date et chaque obligation avant toute signature, paiement ou réponse. En cas de doute, un écrit doit être adressé au service indiqué en rappelant l'identifiant dossier.

## 2. Définitions

Pour l'application du présent document, les termes ci-après ont la signification suivante :

- **Partie** : toute personne physique ou morale désignée comme émetteur, destinataire, souscripteur, titulaire, locataire, employeur ou créancier.
- **Échéance** : date à laquelle une obligation de paiement, de réponse, de résiliation ou de production de pièces devient exigible.
- **Incident** : tout retard, défaut, rejet, non-conformité ou manquement susceptible d'entraîner frais, pénalités ou suspension de service.
- **Pièce justificative** : tout document propre à établir un droit, une qualité, un paiement ou une situation de fait.
- **Force majeure** : événement imprévisible, irrésistible et extérieur rendant impossible l'exécution temporaire d'une obligation.
- **Mise en demeure** : acte formalisant le défaut et ouvrant, le cas échéant, des mesures de suspension, résiliation ou recouvrement.
- **Espace client** : interface numérique permettant le suivi, le téléchargement de pièces et l'envoi de demandes.

## 3. Obligations réciproques

### 3.1 Obligations du destinataire / souscripteur
1. Fournir des informations exactes, complètes et à jour.
2. Signaler sans délai tout changement d'adresse, d'état civil, de RIB ou de situation.
3. Respecter les délais de paiement et de réponse indiqués dans le corps du document.
4. Conserver une copie du présent document et des justificatifs associés pendant au moins **5 ans**.
5. Utiliser les canaux officiels (courrier, espace client, e-mail dédié) pour toute réclamation.
6. Ne pas faire obstacle aux contrôles légitimes nécessaires à l'exécution du dossier.
7. Régulariser spontanément toute anomalie constatée sur un relevé, une facture ou un avis.

### 3.2 Obligations de l'émetteur
1. Informer de manière claire sur les montants, dates et conséquences d'un manquement.
2. Traiter les réclamations dans un délai raisonnable, en principe sous **30 jours**.
3. Assurer la confidentialité des données personnelles conformément au RGPD.
4. Mettre à disposition, sur demande, un historique des opérations ou échanges pertinents.
5. Indiquer les voies de recours amiable et contentieux.
6. Confirmer par écrit les modifications acceptées et les nouvelles échéances applicables.
7. Archiver les documents dans des conditions permettant leur restitution pendant la durée légale.

## 4. Échéancier prévisionnel et montants associés

| Date | Libellé | Montant | Mode |
|------|---------|---------|------|
${scheduleRows}

**Montants de référence complémentaires (fictifs)** : frais de dossier ${amt1}, provision / acompte ${amt2}, plafond annuel ou engagement ${amt3}.

Ces montants ne se substituent pas aux montants principaux figurant dans le corps du document ; ils illustrent le suivi opérationnel et les éventuels frais annexes.

## 5. Historique des échanges (extrait)

| Date | Événement | Statut |
|------|-----------|--------|
${historyRows}

## 6. Conditions particulières et réserves

${clauseRows}

- Toute modification substantielle doit faire l'objet d'un avenant écrit daté et signé (ou accepté électroniquement).
- Les montants indiqués s'entendent en euros TTC sauf mention contraire explicite.
- En cas de contradiction entre le corps du document et une annexe, le corps prévaut sauf disposition d'ordre public.
- Le défaut de paiement après mise en demeure peut entraîner suspension, résiliation, intérêts de retard et frais de recouvrement.
- Les délais exprimés en jours sont des **jours calendaires**, sauf précision « jours ouvrés ».
- Une clause de révision peut s'appliquer en cas d'évolution réglementaire, tarifaire ou technique justifiée.
- La preuve des opérations peut résulter des enregistrements informatiques de l'émetteur, sauf preuve contraire.
- Les notifications sont réputées reçues 48 heures après envoi postal, ou immédiatement en cas d'envoi électronique avec accusé.

## 7. Protection des données personnelles (RGPD)

Les données collectées (identité, coordonnées, situation, données de paiement) sont traitées pour l'exécution du contrat, le suivi administratif, la prévention de la fraude et le respect d'obligations légales.

- Responsable de traitement : l'émetteur désigné en tête de document.
- Destinataires : services internes, sous-traitants habilités, autorités compétentes sur demande légale.
- Durée de conservation : durée de la relation contractuelle puis archivage légal.
- Droits : accès, rectification, effacement, limitation, opposition, portabilité, réclamation auprès de la CNIL.
- Contact DPO (fictif) : dpo@exemple-fictif.fr
- Transferts hors UE : uniquement avec garanties appropriées lorsque cela est nécessaire au traitement.

## 8. Médiation, réclamations et litiges

### 8.1 Réclamation interne
Adressez votre réclamation par écrit en rappelant l'identifiant dossier, les faits, les pièces et la demande. Un accusé de réception est adressé sous 10 jours ouvrés lorsque la réglementation l'exige.

### 8.2 Médiation
En cas de différend non résolu, le médiateur compétent peut être saisi avant toute action judiciaire, lorsque la réglementation l'impose. Les coordonnées du médiateur sont communiquées sur demande ou figurent sur l'espace client.

### 8.3 Juridiction
Le tribunal compétent est celui du ressort du domicile du consommateur lorsque les dispositions protectrices s'appliquent ; à défaut, les règles de procédure civile ordinaires s'appliquent.

## 9. Annexes

### Annexe A — Liste des pièces utiles
- Pièce d'identité en cours de validité
- Justificatif de domicile de moins de 3 mois
- RIB / IBAN au nom du titulaire
- Dernier avis d'échéance, relevé ou facture
- Courriers antérieurs relatifs au même dossier
- Attestation d'employeur, de scolarité ou de ressources le cas échéant
- Procès-verbal, avenant ou tableau d'amortissement selon la nature du document

### Annexe B — Mentions de service
- Horaires d'accueil téléphonique : du lundi au vendredi, 9h–18h
- Délai moyen de traitement courrier : 10 jours ouvrés
- Espace client / téléservice : accessible 24h/24 pour le suivi
- Référence à rappeler dans toute correspondance : voir identifiant dossier ci-dessus
- Langue du document : français
- Exemplaires : original numérique + copie destinataire

### Annexe C — Déclarations
Le destinataire déclare avoir pris connaissance des informations essentielles, des risques de retard, des modalités de résiliation ou de recours, et des conséquences financières attachées au présent document. Il reconnaît que les montants, dates et échéances figurant dans le corps principal constituent des éléments déterminants de son consentement ou de son information.

### Annexe D — Glossaire opérationnel
- **TTC** : toutes taxes comprises
- **HT** : hors taxes
- **RIB / IBAN** : coordonnées bancaires de paiement
- **LRAR** : lettre recommandée avec avis de réception
- **Délai de grâce** : période supplémentaire éventuellement accordée avant sanction

## 10. Signatures et mentions finales

Fait pour valoir ce que de droit.

| Qualité | Nom | Date | Signature |
|---------|-----|------|-----------|
| Émetteur / représentant | ${advisor.fullName} | ${d3} | (signature électronique fictive) |
| Destinataire / souscripteur | (voir en-tête) | ${d4} | (lu et approuvé — fictif) |
| Témoin / agent | ${witness.fullName} | ${d5} | (paraphe fictif) |

**Mentions complémentaires**
- Exemplaire archivé sous format électronique PDF/A (simulation).
- Horodatage système : ${d1} / ${d2} / ${d3}.
- Agent de saisie : ${agent.fullName}.
- Toute reproduction intégrale ou partielle à des fins commerciales est interdite hors cadre de test DocMind.
- Version documentaire : 2026.COMPLEX.${Math.floor(10 + rng() * 89)}

## 11. Synthèse opérationnelle (pour contrôle)

Avant toute action, vérifier :
1. l'identité des parties et l'adresse de correspondance ;
2. les montants exigibles et le mode de règlement ;
3. les dates d'échéance et les délais de réponse ;
4. l'existence d'une contestation écrite éventuelle ;
5. les pièces à joindre et le canal d'envoi recommandé ;
6. la cohérence entre le corps du document et les annexes ;
7. les conséquences d'un non-paiement ou d'une absence de réponse.

Le non-respect de ces points peut retarder le traitement, entraîner des frais supplémentaires ou faire perdre un droit.

## 12. Journal technique (simulation)

| Horodatage | Action système | Opérateur |
|------------|----------------|-----------|
| ${d1} 09:12 | Création du document | ${agent.fullName} |
| ${d2} 14:41 | Contrôle cohérence montants | BATCH-CTRL |
| ${d3} 11:05 | Validation émetteur | ${advisor.fullName} |
| ${d4} 16:22 | Mise à disposition destinataire | PORTAIL |
| ${d5} 08:03 | Archivage légal simulé | ARCHIVE-01 |

`;

  return `${stripped}\n${expansion}${footer}\n`;
}
