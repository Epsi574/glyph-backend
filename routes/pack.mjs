// =============================================================
// ROUTES PACK — pack quotidien + boutique de packs premium
// =============================================================
// GET  /api/pack/status         → statut du pack quotidien
// POST /api/pack/ouvrir         → ouvre le pack gratuit du jour
// GET  /api/pack/boutique       → liste les packs achetables
// POST /api/pack/acheter/:type  → achète un pack premium
// =============================================================

import express from "express";
import { prisma } from "../lib/prisma.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

const router = express.Router();

// =============================================================
// CONFIGURATION DES PACKS
// =============================================================

const PACK_TYPES = {
  quotidien: {
    nom: "Pack du jour",
    description: "3 mots, gratuit, une fois par jour",
    prix: 0,
    gratuit: true,
    monnaieBonus: 10,
    slots: [
      { nom: "quotidien",   proba: { 1: 0.90, 2: 0.09, 3: 0.01 } },
      { nom: "decouverte",  proba: { 1: 0.65, 2: 0.30, 3: 0.05 } },
      { nom: "privilege",   proba: { 1: 0.35, 2: 0.45, 3: 0.20 } },
    ],
  },
  standard: {
    nom: "Pack standard",
    description: "3 mots avec de meilleures chances",
    prix: 100,
    gratuit: false,
    monnaieBonus: 0,
    slots: [
      { nom: "quotidien",   proba: { 1: 0.70, 2: 0.25, 3: 0.05 } },
      { nom: "decouverte",  proba: { 1: 0.45, 2: 0.40, 3: 0.15 } },
      { nom: "privilege",   proba: { 1: 0.20, 2: 0.45, 3: 0.35 } },
    ],
  },
  premium: {
    nom: "Pack rare",
    description: "3 mots avec des chances élevées de mots prisés",
    prix: 500,
    gratuit: false,
    monnaieBonus: 0,
    slots: [
      { nom: "quotidien",   proba: { 1: 0.40, 2: 0.40, 3: 0.20 } },
      { nom: "decouverte",  proba: { 1: 0.20, 2: 0.40, 3: 0.40 } },
      { nom: "privilege",   proba: { 1: 0.05, 2: 0.35, 3: 0.60 } },
    ],
  },
};

// =============================================================
// UTILITAIRES
// =============================================================

function tirerTier(slot) {
  const rand = Math.random();
  const { 3: p3, 2: p2 } = slot.proba;
  if (rand < p3) return 3;
  if (rand < p3 + p2) return 2;
  return 1;
}

async function tirerMotLibre(tier, exclusions = []) {
  const clauseExclusion =
    exclusions.length > 0
      ? `AND m.id NOT IN (${exclusions.join(",")})`
      : "";

  const mot = await prisma.$queryRawUnsafe(`
    SELECT m.id, m.mot, m.tier, m.categorie, m.longueur,
           m.frequence, m.collection, m.definition
    FROM mots m
    WHERE m.tier = $1
      AND m.actif = true
      AND m.id NOT IN (SELECT "motId" FROM inventaire)
      AND m.id NOT IN (SELECT "motId" FROM marche)
      ${clauseExclusion}
    ORDER BY RANDOM()
    LIMIT 1
  `, tier);

  return mot[0] || null;
}

// Tirage générique d'un pack (réutilisé par quotidien + premium)
async function tirerPack(packConfig) {
  const cartes = [];
  const idsDejaUtilises = [];

  for (let i = 0; i < packConfig.slots.length; i++) {
    const slot = packConfig.slots[i];
    const tierDemande = tirerTier(slot);

    let mot = await tirerMotLibre(tierDemande, idsDejaUtilises);
    if (!mot && tierDemande === 3) mot = await tirerMotLibre(2, idsDejaUtilises);
    if (!mot && tierDemande >= 2)  mot = await tirerMotLibre(1, idsDejaUtilises);

    if (mot) {
      cartes.push({
        mot,
        slot: i + 1,
        slotNom: slot.nom,
        tierDemande,
      });
      idsDejaUtilises.push(mot.id);
    }
  }

  return cartes;
}

function statutPack(dernierPack) {
  if (!dernierPack) return { disponible: true, prochainPack: null };

  const maintenant = new Date();
  const derniere = new Date(dernierPack);

  if (derniere.toDateString() === maintenant.toDateString()) {
    const minuit = new Date(maintenant);
    minuit.setHours(24, 0, 0, 0);
    const resteMs = minuit - maintenant;
    const resteH = Math.floor(resteMs / 3600000);
    const resteM = Math.floor((resteMs % 3600000) / 60000);

    return {
      disponible: false,
      prochainPack: `${resteH}h ${resteM}min`,
      prochainPackISO: minuit.toISOString(),
    };
  }

  return { disponible: true, prochainPack: null };
}

// =============================================================
// GET /api/pack/status
// =============================================================

router.get("/status", authMiddleware, async (req, res) => {
  const statut = statutPack(req.joueur.dernierPack);
  res.json({
    ...statut,
    dernierPack: req.joueur.dernierPack,
    monnaie: req.joueur.monnaie,
  });
});

// =============================================================
// GET /api/pack/boutique — liste des packs achetables
// =============================================================

router.get("/boutique", authMiddleware, async (req, res) => {
  const packs = Object.entries(PACK_TYPES)
    .filter(([_, config]) => !config.gratuit)
    .map(([type, config]) => ({
      type,
      nom: config.nom,
      description: config.description,
      prix: config.prix,
      slots: config.slots.map((s, i) => ({
        slot: i + 1,
        nom: s.nom,
        chanceTier2: Math.round((s.proba[2] + s.proba[3]) * 100),
        chanceTier3: Math.round(s.proba[3] * 100),
      })),
    }));

  res.json({ packs, monnaie: req.joueur.monnaie });
});

// =============================================================
// POST /api/pack/ouvrir — pack quotidien gratuit
// =============================================================

router.post("/ouvrir", authMiddleware, async (req, res) => {
  const joueurId = req.joueur.id;
  const packConfig = PACK_TYPES.quotidien;

  try {
    const statut = statutPack(req.joueur.dernierPack);
    if (!statut.disponible) {
      return res.status(429).json({
        erreur: "Pack déjà réclamé aujourd'hui",
        prochainPack: statut.prochainPack,
        prochainPackISO: statut.prochainPackISO,
      });
    }

    const cartes = await tirerPack(packConfig);

    if (cartes.length === 0) {
      return res.status(500).json({ erreur: "Plus aucun mot disponible" });
    }

    const resultat = await prisma.$transaction(async (tx) => {
      const inventaireEntrees = [];

      for (const carte of cartes) {
        await tx.inventaire.create({
          data: { joueurId, motId: carte.mot.id, slot: carte.slot },
        });
        inventaireEntrees.push(carte);
      }

      const joueurMaj = await tx.joueur.update({
        where: { id: joueurId },
        data: {
          dernierPack: new Date(),
          monnaie: { increment: packConfig.monnaieBonus },
        },
      });

      return { inventaireEntrees, joueurMaj };
    });

    res.json({
      succes: true,
      packType: "quotidien",
      pack: resultat.inventaireEntrees.map((e) => ({
        slot: e.slot, slotNom: e.slotNom,
        id: e.mot.id, mot: e.mot.mot, tier: e.mot.tier,
        tierDemande: e.tierDemande, categorie: e.mot.categorie,
        longueur: e.mot.longueur, frequence: e.mot.frequence,
        collection: e.mot.collection, definition: e.mot.definition,
      })),
      monnaie: resultat.joueurMaj.monnaie,
      bonusMonnaie: packConfig.monnaieBonus,
    });
  } catch (err) {
    console.error("Erreur POST /api/pack/ouvrir :", err);
    if (err.code === "P2002") {
      return res.status(409).json({ erreur: "Un mot a été pris par un autre joueur" });
    }
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

// =============================================================
// POST /api/pack/acheter/:type — pack premium (standard ou rare)
// =============================================================

router.post("/acheter/:type", authMiddleware, async (req, res) => {
  const joueurId = req.joueur.id;
  const type = req.params.type;

  const packConfig = PACK_TYPES[type];

  if (!packConfig || packConfig.gratuit) {
    return res.status(400).json({ erreur: "Type de pack invalide" });
  }

  // Vérifier la monnaie
  if (req.joueur.monnaie < packConfig.prix) {
    return res.status(402).json({
      erreur: "Monnaie insuffisante",
      detail: `Il te manque ${packConfig.prix - req.joueur.monnaie} pièces`,
    });
  }

  try {
    const cartes = await tirerPack(packConfig);

    if (cartes.length === 0) {
      return res.status(500).json({ erreur: "Plus aucun mot disponible" });
    }

    const resultat = await prisma.$transaction(async (tx) => {
      const inventaireEntrees = [];

      for (const carte of cartes) {
        await tx.inventaire.create({
          data: { joueurId, motId: carte.mot.id, slot: carte.slot },
        });
        inventaireEntrees.push(carte);
      }

      // Débiter le joueur
      const joueurMaj = await tx.joueur.update({
        where: { id: joueurId },
        data: { monnaie: { decrement: packConfig.prix } },
      });

      return { inventaireEntrees, joueurMaj };
    });

    res.json({
      succes: true,
      packType: type,
      pack: resultat.inventaireEntrees.map((e) => ({
        slot: e.slot, slotNom: e.slotNom,
        id: e.mot.id, mot: e.mot.mot, tier: e.mot.tier,
        tierDemande: e.tierDemande, categorie: e.mot.categorie,
        longueur: e.mot.longueur, frequence: e.mot.frequence,
        collection: e.mot.collection, definition: e.mot.definition,
      })),
      monnaie: resultat.joueurMaj.monnaie,
      prixPaye: packConfig.prix,
    });
  } catch (err) {
    console.error("Erreur POST /api/pack/acheter/:type :", err);
    if (err.code === "P2002") {
      return res.status(409).json({ erreur: "Un mot a été pris par un autre joueur" });
    }
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

export default router;
