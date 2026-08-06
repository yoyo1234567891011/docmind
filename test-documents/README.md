# Documents de test DocMind

Ce dossier contient :

1. **Documents fictifs** générés (`assurances/`, `banques/`, …) — `npm run generate:docs`
2. **Corpus réel anonymisé** (`real-anonymized/`) — `npm run corpus:import` (voir `corpus/README.md`)

## Évaluation par corpus

```bash
npm run evaluate -- --corpus real        # uniquement real-anonymized/
npm run evaluate -- --corpus synthetic   # hors real-anonymized/
npm run evaluate -- --corpus all         # tout (défaut)
npm run test:docs -- --corpus real
```

`npm run generate:docs` **préserve** `real-anonymized/` (ne l’efface pas).

## Avertissement

- Documents générés : **100 % fictifs**, volontairement **longs et complexes**
- Corpus `real-anonymized` : originaux réels **anonymisés** (montants/dates/clauses conservés)
- Aucune valeur juridique
- Chaque `*_expected.json` est la vérité terrain pour l’évaluation

## Convention de nommage (extensible)

Pour ajouter un nouveau document de test :

```text
test-documents/<categorie>/01-mon-document.pdf
test-documents/<categorie>/01-mon-document_expected.json
```

Le script `npm run evaluate` découvre automatiquement tous les PDF et charge le `*_expected.json` du même nom.

Source Markdown (optionnelle, pour régénération) :

```text
01-mon-document.md
01-mon-document.pdf
01-mon-document_expected.json
```

## Format ground truth

```json
{
  "document_type": "",
  "title": "",
  "summary": "",
  "people": [],
  "organizations": [],
  "amounts": [],
  "dates": [],
  "deadlines": [],
  "important_points": [],
  "risks": [],
  "actions": [],
  "risk_score": 0
}
```

## Répartition

| # | Catégorie | Document | Expected |
|---|-----------|----------|----------|
| 1 | Assurances | `assurances/01-contrat-assurance-habitation-ass-821915.md` | `assurances/01-contrat-assurance-habitation-ass-821915_expected.json` |
| 2 | Assurances | `assurances/02-contrat-assurance-habitation-ass-714617.md` | `assurances/02-contrat-assurance-habitation-ass-714617_expected.json` |
| 3 | Assurances | `assurances/03-contrat-assurance-habitation-ass-607319.md` | `assurances/03-contrat-assurance-habitation-ass-607319_expected.json` |
| 4 | Assurances | `assurances/04-contrat-assurance-habitation-ass-500021.md` | `assurances/04-contrat-assurance-habitation-ass-500021_expected.json` |
| 5 | Assurances | `assurances/05-contrat-assurance-habitation-ass-392723.md` | `assurances/05-contrat-assurance-habitation-ass-392723_expected.json` |
| 6 | Assurances | `assurances/06-contrat-assurance-habitation-ass-285425.md` | `assurances/06-contrat-assurance-habitation-ass-285425_expected.json` |
| 7 | Banques | `banques/01-releve-bancaire-banque-horizon-bqe-322695.md` | `banques/01-releve-bancaire-banque-horizon-bqe-322695_expected.json` |
| 8 | Banques | `banques/02-releve-bancaire-banque-horizon-bqe-393217.md` | `banques/02-releve-bancaire-banque-horizon-bqe-393217_expected.json` |
| 9 | Banques | `banques/03-releve-bancaire-banque-horizon-bqe-463739.md` | `banques/03-releve-bancaire-banque-horizon-bqe-463739_expected.json` |
| 10 | Banques | `banques/04-releve-bancaire-banque-horizon-bqe-534261.md` | `banques/04-releve-bancaire-banque-horizon-bqe-534261_expected.json` |
| 11 | Banques | `banques/05-releve-bancaire-banque-horizon-bqe-604783.md` | `banques/05-releve-bancaire-banque-horizon-bqe-604783_expected.json` |
| 12 | Banques | `banques/06-releve-bancaire-banque-horizon-bqe-675305.md` | `banques/06-releve-bancaire-banque-horizon-bqe-675305_expected.json` |
| 13 | Impôts | `impots/01-avis-fiscal-imp-946966.md` | `impots/01-avis-fiscal-imp-946966_expected.json` |
| 14 | Impôts | `impots/02-avis-fiscal-imp-654573.md` | `impots/02-avis-fiscal-imp-654573_expected.json` |
| 15 | Impôts | `impots/03-avis-fiscal-imp-362180.md` | `impots/03-avis-fiscal-imp-362180_expected.json` |
| 16 | Impôts | `impots/04-avis-fiscal-imp-969787.md` | `impots/04-avis-fiscal-imp-969787_expected.json` |
| 17 | Impôts | `impots/05-avis-fiscal-imp-677394.md` | `impots/05-avis-fiscal-imp-677394_expected.json` |
| 18 | Impôts | `impots/06-avis-fiscal-imp-385001.md` | `impots/06-avis-fiscal-imp-385001_expected.json` |
| 19 | CAF | `caf/01-notification-caf-caf-500877.md` | `caf/01-notification-caf-caf-500877_expected.json` |
| 20 | CAF | `caf/02-notification-caf-caf-667583.md` | `caf/02-notification-caf-caf-667583_expected.json` |
| 21 | CAF | `caf/03-notification-caf-caf-834288.md` | `caf/03-notification-caf-caf-834288_expected.json` |
| 22 | CAF | `caf/04-notification-caf-caf-100995.md` | `caf/04-notification-caf-caf-100995_expected.json` |
| 23 | CAF | `caf/05-notification-caf-caf-267700.md` | `caf/05-notification-caf-caf-267700_expected.json` |
| 24 | Mutuelles | `mutuelles/01-contrat-mutuelle-sante-mut-437004.md` | `mutuelles/01-contrat-mutuelle-sante-mut-437004_expected.json` |
| 25 | Mutuelles | `mutuelles/02-contrat-mutuelle-sante-mut-271601.md` | `mutuelles/02-contrat-mutuelle-sante-mut-271601_expected.json` |
| 26 | Mutuelles | `mutuelles/03-contrat-mutuelle-sante-mut-106198.md` | `mutuelles/03-contrat-mutuelle-sante-mut-106198_expected.json` |
| 27 | Mutuelles | `mutuelles/04-contrat-mutuelle-sante-mut-840794.md` | `mutuelles/04-contrat-mutuelle-sante-mut-840794_expected.json` |
| 28 | Mutuelles | `mutuelles/05-contrat-mutuelle-sante-mut-675391.md` | `mutuelles/05-contrat-mutuelle-sante-mut-675391_expected.json` |
| 29 | Contrats de travail | `contrats-de-travail/01-contrat-de-travail-cdi-morel-cdi-827057.md` | `contrats-de-travail/01-contrat-de-travail-cdi-morel-cdi-827057_expected.json` |
| 30 | Contrats de travail | `contrats-de-travail/02-contrat-de-travail-cdi-durand-cdi-649697.md` | `contrats-de-travail/02-contrat-de-travail-cdi-durand-cdi-649697_expected.json` |
| 31 | Contrats de travail | `contrats-de-travail/03-contrat-de-travail-cdi-fournier-cdi-472336.md` | `contrats-de-travail/03-contrat-de-travail-cdi-fournier-cdi-472336_expected.json` |
| 32 | Contrats de travail | `contrats-de-travail/04-contrat-de-travail-cdi-petit-cdi-294975.md` | `contrats-de-travail/04-contrat-de-travail-cdi-petit-cdi-294975_expected.json` |
| 33 | Contrats de travail | `contrats-de-travail/05-contrat-de-travail-cdi-roux-cdi-117614.md` | `contrats-de-travail/05-contrat-de-travail-cdi-roux-cdi-117614_expected.json` |
| 34 | Contrats de travail | `contrats-de-travail/06-contrat-de-travail-cdi-robert-cdi-840252.md` | `contrats-de-travail/06-contrat-de-travail-cdi-robert-cdi-840252_expected.json` |
| 35 | Baux de location | `baux-de-location/01-bail-location-rennes-bail-740347.md` | `baux-de-location/01-bail-location-rennes-bail-740347_expected.json` |
| 36 | Baux de location | `baux-de-location/02-bail-location-lyon-bail-980665.md` | `baux-de-location/02-bail-location-lyon-bail-980665_expected.json` |
| 37 | Baux de location | `baux-de-location/03-bail-location-montpellier-bail-320985.md` | `baux-de-location/03-bail-location-montpellier-bail-320985_expected.json` |
| 38 | Baux de location | `baux-de-location/04-bail-location-bordeaux-bail-561304.md` | `baux-de-location/04-bail-location-bordeaux-bail-561304_expected.json` |
| 39 | Baux de location | `baux-de-location/05-bail-location-angers-bail-801623.md` | `baux-de-location/05-bail-location-angers-bail-801623_expected.json` |
| 40 | Baux de location | `baux-de-location/06-bail-location-rennes-bail-141943.md` | `baux-de-location/06-bail-location-rennes-bail-141943_expected.json` |
| 41 | Factures EDF | `factures-edf/01-facture-electricite-edf-572903.md` | `factures-edf/01-facture-electricite-edf-572903_expected.json` |
| 42 | Factures EDF | `factures-edf/02-facture-electricite-edf-465605.md` | `factures-edf/02-facture-electricite-edf-465605_expected.json` |
| 43 | Factures EDF | `factures-edf/03-facture-electricite-edf-358307.md` | `factures-edf/03-facture-electricite-edf-358307_expected.json` |
| 44 | Factures EDF | `factures-edf/04-facture-electricite-edf-251009.md` | `factures-edf/04-facture-electricite-edf-251009_expected.json` |
| 45 | Factures EDF | `factures-edf/05-facture-electricite-edf-143711.md` | `factures-edf/05-facture-electricite-edf-143711_expected.json` |
| 46 | Factures EDF | `factures-edf/06-facture-electricite-edf-936412.md` | `factures-edf/06-facture-electricite-edf-936412_expected.json` |
| 47 | Factures Orange | `factures-orange/01-facture-orange-ora-100996.md` | `factures-orange/01-facture-orange-ora-100996_expected.json` |
| 48 | Factures Orange | `factures-orange/02-facture-orange-ora-466565.md` | `factures-orange/02-facture-orange-ora-466565_expected.json` |
| 49 | Factures Orange | `factures-orange/03-facture-orange-ora-832134.md` | `factures-orange/03-facture-orange-ora-832134_expected.json` |
| 50 | Factures Orange | `factures-orange/04-facture-orange-ora-297704.md` | `factures-orange/04-facture-orange-ora-297704_expected.json` |
| 51 | Factures Orange | `factures-orange/05-facture-orange-ora-663272.md` | `factures-orange/05-facture-orange-ora-663272_expected.json` |
| 52 | Factures Free | `factures-free/01-facture-free-fre-174846.md` | `factures-free/01-facture-free-fre-174846_expected.json` |
| 53 | Factures Free | `factures-free/02-facture-free-fre-540415.md` | `factures-free/02-facture-free-fre-540415_expected.json` |
| 54 | Factures Free | `factures-free/03-facture-free-fre-905983.md` | `factures-free/03-facture-free-fre-905983_expected.json` |
| 55 | Factures Free | `factures-free/04-facture-free-fre-371553.md` | `factures-free/04-facture-free-fre-371553_expected.json` |
| 56 | Factures Free | `factures-free/05-facture-free-fre-737122.md` | `factures-free/05-facture-free-fre-737122_expected.json` |
| 57 | Factures SFR | `factures-sfr/01-facture-sfr-sfr-217507.md` | `factures-sfr/01-facture-sfr-sfr-217507_expected.json` |
| 58 | Factures SFR | `factures-sfr/02-facture-sfr-sfr-583076.md` | `factures-sfr/02-facture-sfr-sfr-583076_expected.json` |
| 59 | Factures SFR | `factures-sfr/03-facture-sfr-sfr-948645.md` | `factures-sfr/03-facture-sfr-sfr-948645_expected.json` |
| 60 | Factures SFR | `factures-sfr/04-facture-sfr-sfr-414214.md` | `factures-sfr/04-facture-sfr-sfr-414214_expected.json` |
| 61 | Factures SFR | `factures-sfr/05-facture-sfr-sfr-779783.md` | `factures-sfr/05-facture-sfr-sfr-779783_expected.json` |
| 62 | Contrats Internet | `contrats-internet/01-contrat-internet-fibre-net-485785.md` | `contrats-internet/01-contrat-internet-fibre-net-485785_expected.json` |
| 63 | Contrats Internet | `contrats-internet/02-contrat-internet-fibre-net-378487.md` | `contrats-internet/02-contrat-internet-fibre-net-378487_expected.json` |
| 64 | Contrats Internet | `contrats-internet/03-contrat-internet-fibre-net-271189.md` | `contrats-internet/03-contrat-internet-fibre-net-271189_expected.json` |
| 65 | Contrats Internet | `contrats-internet/04-contrat-internet-fibre-net-163891.md` | `contrats-internet/04-contrat-internet-fibre-net-163891_expected.json` |
| 66 | Contrats Internet | `contrats-internet/05-contrat-internet-fibre-net-956592.md` | `contrats-internet/05-contrat-internet-fibre-net-956592_expected.json` |
| 67 | Contrats téléphoniques | `contrats-telephoniques/01-contrat-forfait-mobile-mob-887882.md` | `contrats-telephoniques/01-contrat-forfait-mobile-mob-887882_expected.json` |
| 68 | Contrats téléphoniques | `contrats-telephoniques/02-contrat-forfait-mobile-mob-722479.md` | `contrats-telephoniques/02-contrat-forfait-mobile-mob-722479_expected.json` |
| 69 | Contrats téléphoniques | `contrats-telephoniques/03-contrat-forfait-mobile-mob-557076.md` | `contrats-telephoniques/03-contrat-forfait-mobile-mob-557076_expected.json` |
| 70 | Contrats téléphoniques | `contrats-telephoniques/04-contrat-forfait-mobile-mob-391673.md` | `contrats-telephoniques/04-contrat-forfait-mobile-mob-391673_expected.json` |
| 71 | Contrats téléphoniques | `contrats-telephoniques/05-contrat-forfait-mobile-mob-226270.md` | `contrats-telephoniques/05-contrat-forfait-mobile-mob-226270_expected.json` |
| 72 | Courriers administratifs | `courriers-administratifs/01-courrier-administratif-adm-114630.md` | `courriers-administratifs/01-courrier-administratif-adm-114630_expected.json` |
| 73 | Courriers administratifs | `courriers-administratifs/02-courrier-administratif-adm-849226.md` | `courriers-administratifs/02-courrier-administratif-adm-849226_expected.json` |
| 74 | Courriers administratifs | `courriers-administratifs/03-courrier-administratif-adm-683823.md` | `courriers-administratifs/03-courrier-administratif-adm-683823_expected.json` |
| 75 | Courriers administratifs | `courriers-administratifs/04-courrier-administratif-adm-518420.md` | `courriers-administratifs/04-courrier-administratif-adm-518420_expected.json` |
| 76 | Courriers administratifs | `courriers-administratifs/05-courrier-administratif-adm-353017.md` | `courriers-administratifs/05-courrier-administratif-adm-353017_expected.json` |
| 77 | Courriers administratifs | `courriers-administratifs/06-courrier-administratif-adm-187614.md` | `courriers-administratifs/06-courrier-administratif-adm-187614_expected.json` |
| 78 | Relances de paiement | `relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md` | `relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955_expected.json` |
| 79 | Relances de paiement | `relances-de-paiement/02-1ere-relance-de-paiement-rel-804176.md` | `relances-de-paiement/02-1ere-relance-de-paiement-rel-804176_expected.json` |
| 80 | Relances de paiement | `relances-de-paiement/03-2e-relance-de-paiement-rel-926396.md` | `relances-de-paiement/03-2e-relance-de-paiement-rel-926396_expected.json` |
| 81 | Relances de paiement | `relances-de-paiement/04-mise-en-demeure-de-paiement-rel-148618.md` | `relances-de-paiement/04-mise-en-demeure-de-paiement-rel-148618_expected.json` |
| 82 | Relances de paiement | `relances-de-paiement/05-1ere-relance-de-paiement-rel-270839.md` | `relances-de-paiement/05-1ere-relance-de-paiement-rel-270839_expected.json` |
| 83 | Relances de paiement | `relances-de-paiement/06-mise-en-demeure-de-paiement-rel-393059.md` | `relances-de-paiement/06-mise-en-demeure-de-paiement-rel-393059_expected.json` |
| 84 | Conditions générales de vente | `conditions-generales-de-vente/01-cgv-boutique-nordik-cgv-479526.md` | `conditions-generales-de-vente/01-cgv-boutique-nordik-cgv-479526_expected.json` |
| 85 | Conditions générales de vente | `conditions-generales-de-vente/02-cgv-boutique-nordik-cgv-187133.md` | `conditions-generales-de-vente/02-cgv-boutique-nordik-cgv-187133_expected.json` |
| 86 | Conditions générales de vente | `conditions-generales-de-vente/03-cgv-boutique-nordik-cgv-794739.md` | `conditions-generales-de-vente/03-cgv-boutique-nordik-cgv-794739_expected.json` |
| 87 | Conditions générales de vente | `conditions-generales-de-vente/04-cgv-boutique-nordik-cgv-502347.md` | `conditions-generales-de-vente/04-cgv-boutique-nordik-cgv-502347_expected.json` |
| 88 | Conditions générales de vente | `conditions-generales-de-vente/05-cgv-boutique-nordik-cgv-209954.md` | `conditions-generales-de-vente/05-cgv-boutique-nordik-cgv-209954_expected.json` |
| 89 | Conditions générales de vente | `conditions-generales-de-vente/06-cgv-boutique-nordik-cgv-817560.md` | `conditions-generales-de-vente/06-cgv-boutique-nordik-cgv-817560_expected.json` |
| 90 | Devis | `devis/01-devis-dev-871546.md` | `devis/01-devis-dev-871546_expected.json` |
| 91 | Devis | `devis/02-devis-dev-337116.md` | `devis/02-devis-dev-337116_expected.json` |
| 92 | Devis | `devis/03-devis-dev-702684.md` | `devis/03-devis-dev-702684_expected.json` |
| 93 | Devis | `devis/04-devis-dev-168254.md` | `devis/04-devis-dev-168254_expected.json` |
| 94 | Devis | `devis/05-devis-dev-533823.md` | `devis/05-devis-dev-533823_expected.json` |
| 95 | Devis | `devis/06-devis-dev-899392.md` | `devis/06-devis-dev-899392_expected.json` |
| 96 | Contrats de prêt | `contrats-de-pret/01-offre-de-pret-personnel-prt-637352.md` | `contrats-de-pret/01-offre-de-pret-personnel-prt-637352_expected.json` |
| 97 | Contrats de prêt | `contrats-de-pret/02-offre-de-pret-personnel-prt-530054.md` | `contrats-de-pret/02-offre-de-pret-personnel-prt-530054_expected.json` |
| 98 | Contrats de prêt | `contrats-de-pret/03-offre-de-pret-personnel-prt-422756.md` | `contrats-de-pret/03-offre-de-pret-personnel-prt-422756_expected.json` |
| 99 | Contrats de prêt | `contrats-de-pret/04-offre-de-pret-personnel-prt-315458.md` | `contrats-de-pret/04-offre-de-pret-personnel-prt-315458_expected.json` |
| 100 | Contrats de prêt | `contrats-de-pret/05-offre-de-pret-personnel-prt-208160.md` | `contrats-de-pret/05-offre-de-pret-personnel-prt-208160_expected.json` |

## Régénération

```bash
npm run generate:docs
npm run generate:pdfs
```

## Évaluation (`npm run evaluate`)

Prérequis : serveur DocMind démarré (`npm run dev`) + Ollama.

```bash
npm run evaluate
npm run evaluate:quick
npx tsx --tsconfig tsconfig.json scripts/evaluate.ts --category assurances --limit 5
```

Rapport HTML dans `reports/`.
