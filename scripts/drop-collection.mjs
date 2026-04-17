// =============================================================
// SCRIPT DE DROP — Importer une nouvelle collection
// =============================================================
//
// Ce script sert à lancer un "drop" : ajouter une nouvelle
// catégorie de mots au jeu (verbes, adjectifs, adverbes...).
//
// USAGE :
//   node scripts/drop-collection.mjs verbes
//   node scripts/drop-collection.mjs adjectifs
//   node scripts/drop-collection.mjs adverbes
//
// Les mots sont importés avec actif=false par défaut.
// Pour activer le drop (rendre les mots disponibles en pack),
// exécute ensuite :
//   node scripts/drop-collection.mjs activer verbes
//
// =============================================================

import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

// Mapping collection → catégorie Lexique
const COLLECTIONS = {
  verbes:     { cgram: "VER", categorie: "verbe" },
  adjectifs:  { cgram: "ADJ", categorie: "adjectif" },
  adverbes:   { cgram: "ADV", categorie: "adverbe" },
};

const args = process.argv.slice(2);
const commande = args[0];

// ── Commande : activer un drop ──
if (commande === "activer") {
  const collection = args[1];
  if (!collection) {
    console.error("Usage : node scripts/drop-collection.mjs activer <collection>");
    process.exit(1);
  }

  const result = await prisma.mot.updateMany({
    where: { collection, actif: false },
    data: { actif: true },
  });

  console.log(`🎉 Drop "${collection}" activé ! ${result.count} mots sont maintenant disponibles en pack.`);
  await prisma.$disconnect();
  process.exit(0);
}

// ── Commande : importer une collection ──
const collection = commande;
const config = COLLECTIONS[collection];

if (!config) {
  console.error(`Collection inconnue : "${collection}"`);
  console.error(`Collections disponibles : ${Object.keys(COLLECTIONS).join(", ")}`);
  process.exit(1);
}

const fichierLexique = "scripts/Lexique382.tsv";
if (!fs.existsSync(fichierLexique)) {
  console.error("Fichier Lexique non trouvé. Lance d'abord : node scripts/import-dictionnaire.mjs");
  process.exit(1);
}

console.log(`📦 Import de la collection "${collection}" (${config.categorie})...\n`);

// Parser Lexique
const contenu = fs.readFileSync(fichierLexique, "utf-8");
const lignes = contenu.split("\n");
const entetes = lignes[0].split("\t");
const idx = {
  ortho: entetes.findIndex((e) => e.includes("ortho")),
  freq: entetes.findIndex((e) => e.includes("freqfilm")),
  cgram: entetes.findIndex((e) => e.includes("cgram")),
  nbLettres: entetes.findIndex((e) => e.includes("nblettres")),
};

const motsDeja = new Set();
const mots = [];

for (let i = 1; i < lignes.length; i++) {
  const cols = lignes[i].split("\t");
  if (cols.length < 5) continue;

  const mot = cols[idx.ortho]?.trim().toLowerCase();
  const freq = parseFloat(cols[idx.freq]) || 0;
  const cgram = cols[idx.cgram]?.trim().toUpperCase();
  const nbLettres = parseInt(cols[idx.nbLettres]) || mot?.length || 0;

  if (!mot || motsDeja.has(mot)) continue;
  if (cgram !== config.cgram) continue;
  if (nbLettres < 3 || nbLettres > 25) continue;
  if (!/^[a-zàâäéèêëïîôùûüÿçœæ]+$/i.test(mot)) continue;

  motsDeja.add(mot);
  mots.push({ mot, frequence: freq, longueur: nbLettres });
}

// Calcul des tiers (même logique inversée)
const parFrequence = [...mots].sort((a, b) => a.frequence - b.frequence);
const seuil2 = Math.floor(parFrequence.length * 0.60);
const seuil3 = Math.floor(parFrequence.length * 0.90);

parFrequence.forEach((m, i) => {
  m.tier = i < seuil2 ? 1 : i < seuil3 ? 2 : 3;
});

console.log(`   ${mots.length} ${config.categorie}s extraits`);
console.log(`   Tier 1: ${parFrequence.filter((m) => m.tier === 1).length}`);
console.log(`   Tier 2: ${parFrequence.filter((m) => m.tier === 2).length}`);
console.log(`   Tier 3: ${parFrequence.filter((m) => m.tier === 3).length}`);

// Insertion (actif = false → pas encore droppable)
let inseres = 0;
for (let i = 0; i < mots.length; i += 500) {
  const lot = mots.slice(i, i + 500);
  const result = await prisma.mot.createMany({
    data: lot.map((m) => ({
      mot: m.mot,
      tier: m.tier,
      categorie: config.categorie,
      longueur: m.longueur,
      frequence: m.frequence,
      collection,
      actif: false, // ← En attente du drop !
    })),
    skipDuplicates: true,
  });
  inseres += result.count;
}

console.log(`\n✅ ${inseres} ${config.categorie}s importés (inactifs)`);
console.log(`   Pour activer le drop : node scripts/drop-collection.mjs activer ${collection}`);

await prisma.$disconnect();
