// =============================================================
// SCRIPT DE NETTOYAGE — Dictionnaire (v2, robuste)
// =============================================================
//
// Corrigé pour gérer :
//   - Les doublons dans motsBDD (même "mot" avec ids différents)
//   - Les cas où un mot est à la fois cible d'augmentation et de suppression
//   - Les erreurs individuelles (on continue même si un update échoue)
//
// POUR LANCER : npm run clean
// =============================================================

import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

// =============================================================
// ÉTAPE 0 : Charger les données de Lexique 3
// =============================================================

function chargerLexique() {
  const fichier = "scripts/Lexique383.tsv";
  if (!fs.existsSync(fichier)) {
    console.error("❌ Fichier Lexique non trouvé. Lance d'abord : npm run import");
    process.exit(1);
  }

  console.log("📖 Chargement de Lexique 3...");
  const contenu = fs.readFileSync(fichier, "utf-8");
  const lignes = contenu.split("\n");
  const entetes = lignes[0].split("\t");

  const idx = {
    ortho: entetes.indexOf("ortho"),
    lemme: entetes.indexOf("lemme"),
    nombre: entetes.indexOf("nombre"),
    cgram: entetes.indexOf("cgram"),
    freq: entetes.indexOf("freqfilms2"),
  };

  if (idx.ortho === -1) idx.ortho = entetes.findIndex((e) => e.includes("ortho"));
  if (idx.lemme === -1) idx.lemme = entetes.findIndex((e) => e.includes("lemme"));
  if (idx.nombre === -1) idx.nombre = entetes.findIndex((e) => e.includes("nombre"));
  if (idx.cgram === -1) idx.cgram = entetes.findIndex((e) => e.includes("cgram"));
  if (idx.freq === -1) idx.freq = entetes.findIndex((e) => e.includes("freqfilm"));

  console.log("   Colonnes :", idx);

  // Un mot (ortho) → une seule info (on garde celle avec la fréquence la plus haute)
  const infos = new Map();

  for (let i = 1; i < lignes.length; i++) {
    const cols = lignes[i].split("\t");
    if (cols.length < 5) continue;

    const ortho = cols[idx.ortho]?.trim().toLowerCase();
    const lemme = cols[idx.lemme]?.trim().toLowerCase();
    const nombre = cols[idx.nombre]?.trim().toLowerCase();
    const cgram = cols[idx.cgram]?.trim().toUpperCase();
    const freq = parseFloat(cols[idx.freq]) || 0;

    if (!ortho || cgram !== "NOM") continue;

    const existant = infos.get(ortho);
    if (!existant || freq > existant.freq) {
      infos.set(ortho, { lemme, nombre, cgram, freq });
    }
  }

  console.log(`   ${infos.size} entrées NOM chargées depuis Lexique\n`);
  return infos;
}

// =============================================================
// ÉTAPE 1 : Nettoyer les pluriels (version robuste)
// =============================================================
//
// Stratégie :
//   1. Identifier tous les mots de la BDD qui sont des PLURIELS selon Lexique
//   2. Pour chaque pluriel :
//      - Récupérer le mot + vérifier qu'il existe encore (requête fraîche)
//      - Chercher le singulier correspondant (requête fraîche)
//      - Si singulier existe → transférer la fréquence, supprimer le pluriel
//      - Sinon → renommer le pluriel en singulier (si libre)
//   3. Tout est dans un try-catch : si un cas spécifique plante, on continue
//
// =============================================================

async function nettoyerPluriels(infosLexique) {
  console.log("🔤 Étape 1 — Nettoyage des pluriels...\n");

  // Récupérer tous les mots actuels de la BDD
  const motsBDD = await prisma.mot.findMany({
    select: { id: true, mot: true, frequence: true },
  });

  console.log(`   ${motsBDD.length} mots en BDD à examiner`);

  // Filtrer pour ne garder que les pluriels selon Lexique
  const pluriels = [];
  for (const motBDD of motsBDD) {
    const info = infosLexique.get(motBDD.mot);
    if (info && info.nombre === "p" && info.lemme && info.lemme !== motBDD.mot) {
      pluriels.push({ ...motBDD, lemme: info.lemme });
    }
  }

  console.log(`   ${pluriels.length} pluriels identifiés à traiter\n`);

  let supprimes = 0;
  let renommes = 0;
  let fusions = 0;
  let ignores = 0;

  // Traiter un pluriel à la fois, avec requêtes fraîches à chaque itération
  for (let i = 0; i < pluriels.length; i++) {
    const pluriel = pluriels[i];

    // Barre de progression
    if (i % 200 === 0) {
      const pct = Math.round((i / pluriels.length) * 100);
      process.stdout.write(`\r   Progression : ${pct}% (${i}/${pluriels.length})`);
    }

    try {
      // 1. Vérifier que le pluriel existe toujours en BDD
      const plurielActuel = await prisma.mot.findUnique({
        where: { id: pluriel.id },
      });
      if (!plurielActuel) {
        ignores++;
        continue;
      }

      // 2. Chercher le singulier en BDD
      const singulier = await prisma.mot.findUnique({
        where: { mot: pluriel.lemme },
      });

      if (singulier) {
        // Cas A : singulier existe → fusion
        // Fusionner la fréquence, puis supprimer le pluriel
        await prisma.mot.update({
          where: { id: singulier.id },
          data: { frequence: { increment: plurielActuel.frequence } },
        });

        // Supprimer le pluriel (si pas de relation qui empêche)
        await prisma.mot.delete({ where: { id: plurielActuel.id } });
        supprimes++;
        fusions++;
      } else {
        // Cas B : singulier n'existe pas → renommer le pluriel en singulier
        // (le singulier est "libre", on peut le prendre)
        await prisma.mot.update({
          where: { id: plurielActuel.id },
          data: {
            mot: pluriel.lemme,
            longueur: pluriel.lemme.length,
          },
        });
        renommes++;
      }
    } catch (e) {
      // Erreur isolée : on loggue et on continue
      // Cas typique : collision sur contrainte unique (un autre pluriel a
      // déjà renommé vers ce singulier pendant cette passe)
      ignores++;
    }
  }

  process.stdout.write("\r" + " ".repeat(60) + "\r"); // Effacer la ligne de progression

  console.log(`   ✅ ${supprimes} pluriels supprimés (avec fusion de fréquence)`);
  console.log(`   ✅ ${renommes} pluriels renommés en leur singulier`);
  console.log(`   ⚠  ${ignores} cas ignorés (collisions ou déjà traités)\n`);
}

// =============================================================
// ÉTAPE 2 : Fusionner les homonymes (doublons exacts)
// =============================================================

async function fusionnerHomonymes() {
  console.log("🔀 Étape 2 — Vérification des homonymes...\n");

  const doublons = await prisma.$queryRaw`
    SELECT mot, COUNT(*)::int as nb
    FROM mots
    GROUP BY mot
    HAVING COUNT(*) > 1
  `;

  if (doublons.length === 0) {
    console.log("   ✅ Aucun doublon trouvé\n");
    return;
  }

  console.log(`   ${doublons.length} mots en doublon, fusion en cours...`);

  let fusions = 0;

  for (const { mot } of doublons) {
    try {
      const entrees = await prisma.mot.findMany({
        where: { mot },
        orderBy: { frequence: "desc" },
      });

      if (entrees.length <= 1) continue;

      const [garder, ...supprimer] = entrees;
      const freqTotale = entrees.reduce((sum, e) => sum + e.frequence, 0);

      await prisma.mot.update({
        where: { id: garder.id },
        data: { frequence: freqTotale },
      });

      for (const s of supprimer) {
        try {
          await prisma.mot.delete({ where: { id: s.id } });
          fusions++;
        } catch (e) {
          // Déjà supprimé ou possédé par un joueur
        }
      }
    } catch (e) {
      // Continuer malgré les erreurs individuelles
    }
  }

  console.log(`   ✅ ${fusions} doublons fusionnés\n`);
}

// =============================================================
// ÉTAPE 3 : Supprimer les mots offensants
// =============================================================

async function supprimerOffensants() {
  console.log("🚫 Étape 3 — Suppression des mots offensants...\n");

  const fichierBlocage = "scripts/mots-bloques.txt";

  if (!fs.existsSync(fichierBlocage)) {
    console.log("   ⚠ Fichier mots-bloques.txt non trouvé, étape ignorée.\n");
    return;
  }

  const contenu = fs.readFileSync(fichierBlocage, "utf-8");
  const motsBloques = contenu
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));

  console.log(`   ${motsBloques.length} mots dans la liste de blocage`);

  let supprimes = 0;
  for (const mot of motsBloques) {
    try {
      const result = await prisma.mot.deleteMany({ where: { mot } });
      supprimes += result.count;
    } catch (e) {
      // Impossible à supprimer (possédé par un joueur par exemple)
    }
  }

  console.log(`   ✅ ${supprimes} mots offensants supprimés\n`);
}

// =============================================================
// ÉTAPE 4 : Recalculer les tiers
// =============================================================

async function recalculerTiers() {
  console.log("🎲 Étape 4 — Recalcul des tiers de drop...\n");

  const mots = await prisma.mot.findMany({
    select: { id: true, frequence: true },
    orderBy: { frequence: "asc" },
  });

  const total = mots.length;
  const seuilTier3 = Math.floor(total * 0.10);
  const seuilTier2 = Math.floor(total * 0.40);

  const updates = { 1: [], 2: [], 3: [] };

  mots.forEach((m, i) => {
    const tier = i < seuilTier3 ? 3 : i < seuilTier2 ? 2 : 1;
    updates[tier].push(m.id);
  });

  // UpdateMany par lots (PostgreSQL a une limite ~65535 paramètres)
  for (const [tier, ids] of Object.entries(updates)) {
    const tailleLot = 5000;
    for (let i = 0; i < ids.length; i += tailleLot) {
      const lot = ids.slice(i, i + tailleLot);
      await prisma.mot.updateMany({
        where: { id: { in: lot } },
        data: { tier: parseInt(tier) },
      });
    }
  }

  console.log(`   Total après nettoyage : ${total} mots`);
  console.log(`   Tier 1 (drop facile)    : ${updates[1].length} (${((updates[1].length / total) * 100).toFixed(1)}%)`);
  console.log(`   Tier 2 (drop moyen)     : ${updates[2].length} (${((updates[2].length / total) * 100).toFixed(1)}%)`);
  console.log(`   Tier 3 (drop difficile) : ${updates[3].length} (${((updates[3].length / total) * 100).toFixed(1)}%)`);

  const exemplesT3 = await prisma.mot.findMany({
    where: { tier: 3 },
    orderBy: { frequence: "asc" },
    take: 5,
    select: { mot: true, frequence: true },
  });
  const exemplesT1 = await prisma.mot.findMany({
    where: { tier: 1 },
    orderBy: { frequence: "desc" },
    take: 5,
    select: { mot: true, frequence: true },
  });

  console.log(`\n   Exemples Tier 3 (obscurs) : ${exemplesT3.map((m) => `${m.mot} (${m.frequence.toFixed(1)}/M)`).join(", ")}`);
  console.log(`   Exemples Tier 1 (communs) : ${exemplesT1.map((m) => m.mot).join(", ")}\n`);
}

// =============================================================
// POINT D'ENTRÉE
// =============================================================

async function main() {
  console.log("🧹 === NETTOYAGE DU DICTIONNAIRE ===\n");

  try {
    const infosLexique = chargerLexique();

    await nettoyerPluriels(infosLexique);
    await fusionnerHomonymes();
    await supprimerOffensants();
    await recalculerTiers();

    console.log("🎉 === NETTOYAGE TERMINÉ ===");
    console.log("   Vérifie avec : npm run studio\n");
  } catch (err) {
    console.error("\n❌ Erreur fatale :", err.message);
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
