// =============================================================
// SCRIPT D'IMPORT v2 — Système hybride (tiers de drop inversés)
// =============================================================
//
// LOGIQUE INVERSÉE :
//   Tier 3 (drop difficile) = mots FRÉQUENTS en français (prisés)
//   Tier 2 (drop moyen)     = mots COURANTS (reconnaissables)
//   Tier 1 (drop facile)    = mots RARES en français (niche)
//
// COLLECTION "FONDATION" : noms uniquement (MVP)
// Les verbes, adjectifs, adverbes viendront dans des drops futurs.
//
// POUR LANCER : node scripts/import-dictionnaire.mjs
// =============================================================

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const prisma = new PrismaClient();

// =============================================================
// CONFIGURATION
// =============================================================

const CONFIG = {
  // Source : Lexique 3 (base lexicale française open-source)
  lexiqueUrl:
    "http://www.lexique.org/databases/Lexique383/Lexique383.tsv",
  localFile: "scripts/Lexique383.tsv",

  // Collection "Fondation" = noms uniquement
  // Les autres catégories seront importées dans des drops futurs
  categoriesActives: {
    fondation: ["NOM"],         // Drop de lancement
    // verbes:    ["VER"],       // Drop futur #1
    // adjectifs: ["ADJ"],       // Drop futur #2
    // adverbes:  ["ADV"],       // Drop futur #3
  },

  // Collection à importer maintenant
  collectionActive: "fondation",

  // Filtres
  longueurMin: 3,
  longueurMax: 25,

  // Taille des lots pour l'insertion en BDD
  tailleLot: 500,
};

// =============================================================
// ÉTAPE 1 : Télécharger Lexique 3
// =============================================================

async function telechargerLexique() {
  if (fs.existsSync(CONFIG.localFile)) {
    console.log("📦 Fichier Lexique déjà présent, téléchargement ignoré.");
    return;
  }

  console.log("⬇️  Téléchargement de Lexique 3 (~25 Mo)...");

  const fetch = globalThis.fetch || (await import("node-fetch")).default;
  const response = await fetch(CONFIG.lexiqueUrl);

  if (!response.ok) {
    throw new Error(`Échec du téléchargement : ${response.statusText}`);
  }

  fs.mkdirSync(path.dirname(CONFIG.localFile), { recursive: true });
  const fileStream = createWriteStream(CONFIG.localFile);
  await pipeline(response.body, fileStream);

  console.log("✅ Téléchargement terminé !");
}

// =============================================================
// ÉTAPE 2 : Parser le fichier TSV (noms uniquement)
// =============================================================

function parserLexique() {
  console.log("\n📖 Lecture et parsing du fichier...");

  const contenu = fs.readFileSync(CONFIG.localFile, "utf-8");
  const lignes = contenu.split("\n");
  const entetes = lignes[0].split("\t");

  // Repérer les colonnes
  const idx = {
    ortho: entetes.findIndex((e) => e.includes("ortho")),
    freq: entetes.findIndex((e) => e.includes("freqfilm")),
    cgram: entetes.findIndex((e) => e.includes("cgram")),
    nbLettres: entetes.findIndex((e) => e.includes("nblettres")),
  };

  console.log("   Colonnes détectées :", idx);

  const collection = CONFIG.collectionActive;
  const categoriesGardees = CONFIG.categoriesActives[collection];

  const motsDeja = new Set();
  const mots = [];

  for (let i = 1; i < lignes.length; i++) {
    const cols = lignes[i].split("\t");
    if (cols.length < 5) continue;

    const mot = cols[idx.ortho]?.trim().toLowerCase();
    const freq = parseFloat(cols[idx.freq]) || 0;
    const cgram = cols[idx.cgram]?.trim().toUpperCase();
    const nbLettres = parseInt(cols[idx.nbLettres]) || mot?.length || 0;

    // ── FILTRES ──
    if (!mot || motsDeja.has(mot)) continue;
    if (!categoriesGardees.includes(cgram)) continue;
    if (nbLettres < CONFIG.longueurMin || nbLettres > CONFIG.longueurMax) continue;
    if (!/^[a-zàâäéèêëïîôùûüÿçœæ]+$/i.test(mot)) continue;

    motsDeja.add(mot);

    mots.push({
      mot,
      frequence: freq,
      categorie: mapCategorie(cgram),
      longueur: nbLettres,
      collection,
    });
  }

  console.log(`✅ ${mots.length} noms uniques extraits pour la collection "${collection}"`);
  return mots;
}

// =============================================================
// ÉTAPE 3 : Calculer les tiers de drop
// =============================================================
//
//   TIER 3 (drop DIFFICILE, 5-20% selon le slot)
//     → Les mots les moins FRÉQUENTS en français
//     → "flavescent", "smaragdin", "hypostase"
//     → Rares dans la vraie vie → rares dans le jeu
//
//   TIER 2 (drop MOYEN, 9-45% selon le slot)
//     → Mots reconnaissables mais pas courants
//     → "boulangerie", "crépuscule", "parapluie"
//
//   TIER 1 (drop FACILE, 35-90% selon le slot)
//     → Mots très fréquents en français
//     → "maison", "pantalon", "soleil"
//     → Communs dans la vraie vie → communs dans le jeu
//
// =============================================================

function calculerTiers(mots) {
  console.log("\n🎲 Calcul des tiers de drop...");

  // Trier par fréquence CROISSANTE (les plus rares d'abord)
  const parFrequence = [...mots].sort((a, b) => a.frequence - b.frequence);

  // Seuils : les mots les moins fréquents sont les plus durs à obtenir
  //
  //  ├── 10% des mots (les moins fréquents) ──→ Tier 3 (drop difficile)
  //  ├── 30% des mots (fréquence moyenne)   ──→ Tier 2 (drop moyen)
  //  └── 60% des mots (les plus fréquents)  ──→ Tier 1 (drop facile)
  //
  // On met 10% en tier 3 parce que les probabilités de drop
  // du slot 3 montent jusqu'à 20% — il faut assez de mots pour alimenter
  // le tirage sans que le pool se vide trop vite.

  const seuilTier3 = Math.floor(parFrequence.length * 0.10);
  const seuilTier2 = Math.floor(parFrequence.length * 0.40);

  let stats = { 1: 0, 2: 0, 3: 0 };

  for (let i = 0; i < parFrequence.length; i++) {
    const m = parFrequence[i];

    if (i < seuilTier3) {
      m.tier = 3; // Mot rare en français → drop difficile
    } else if (i < seuilTier2) {
      m.tier = 2; // Mot courant → drop moyen
    } else {
      m.tier = 1; // Mot très fréquent → drop facile
    }

    stats[m.tier]++;
  }

  const total = mots.length;
  console.log(`   Tier 1 (drop facile)    : ${stats[1]} mots (${((stats[1] / total) * 100).toFixed(1)}%)`);
  console.log(`   Tier 2 (drop moyen)     : ${stats[2]} mots (${((stats[2] / total) * 100).toFixed(1)}%)`);
  console.log(`   Tier 3 (drop difficile) : ${stats[3]} mots (${((stats[3] / total) * 100).toFixed(1)}%)`);

  // Exemples par tier
  const exemplesTier3 = parFrequence.filter((m) => m.tier === 3).slice(0, 5);
  const exemplesTier1 = parFrequence.filter((m) => m.tier === 1).slice(-5);

  console.log(`\n   Exemples Tier 3 (obscurs) : ${exemplesTier3.map((m) => m.mot).join(", ")}`);
  console.log(`   Exemples Tier 1 (communs) : ${exemplesTier1.map((m) => m.mot).join(", ")}`);

  return mots;
}

// =============================================================
// ÉTAPE 4 : Insérer dans PostgreSQL
// =============================================================

async function insererEnBDD(mots) {
  console.log(`\n💾 Insertion de ${mots.length} mots en base de données...`);

  let inseres = 0;
  let ignores = 0;

  for (let i = 0; i < mots.length; i += CONFIG.tailleLot) {
    const lot = mots.slice(i, i + CONFIG.tailleLot);

    const result = await prisma.mot.createMany({
      data: lot.map((m) => ({
        mot: m.mot,
        definition: null,
        tier: m.tier,
        categorie: m.categorie,
        longueur: m.longueur,
        frequence: m.frequence,
        collection: m.collection,
        actif: true, // Noms actifs dès le lancement
      })),
      skipDuplicates: true,
    });

    inseres += result.count;
    ignores += lot.length - result.count;

    const pct = Math.round(((i + lot.length) / mots.length) * 100);
    process.stdout.write(`\r   Progression : ${pct}% (${inseres} insérés)`);
  }

  console.log(`\n✅ Import terminé : ${inseres} insérés, ${ignores} ignorés (doublons)`);
}

// =============================================================
// UTILITAIRES
// =============================================================

function mapCategorie(cgram) {
  const map = {
    NOM: "nom",
    ADJ: "adjectif",
    VER: "verbe",
    ADV: "adverbe",
  };
  return map[cgram] || cgram.toLowerCase();
}

// =============================================================
// POINT D'ENTRÉE
// =============================================================

async function main() {
  console.log("🎮 === IMPORT DU DICTIONNAIRE — Collection Fondation (noms) ===\n");

  try {
    await telechargerLexique();
    const mots = parserLexique();
    const motsAvecTiers = calculerTiers(mots);
    await insererEnBDD(motsAvecTiers);

    // Résumé final
    const total = await prisma.mot.count();
    const t1 = await prisma.mot.count({ where: { tier: 1 } });
    const t2 = await prisma.mot.count({ where: { tier: 2 } });
    const t3 = await prisma.mot.count({ where: { tier: 3 } });

    console.log("\n🎉 === IMPORT RÉUSSI ===");
    console.log(`   Total en BDD : ${total} mots`);
    console.log(`   Tier 1 (drop facile)    : ${t1}`);
    console.log(`   Tier 2 (drop moyen)     : ${t2}`);
    console.log(`   Tier 3 (drop difficile) : ${t3}`);
    console.log("\n   Vérifie avec : npx prisma studio");
  } catch (err) {
    console.error("\n❌ Erreur :", err.message);
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
