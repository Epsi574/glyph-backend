// =============================================================
// ROUTES PROFIL — profil public d'un joueur (sans auth)
// =============================================================
// GET /api/profil/:pseudo
//   Pas d'authentification requise.
//   Retourne uniquement les infos publiques (jamais l'email).
// =============================================================

import express from "express";
import { prisma } from "../lib/prisma.mjs";

const router = express.Router();

// =============================================================
// GET /api/profil/:pseudo
// =============================================================

router.get("/:pseudo", async (req, res) => {
  const { pseudo } = req.params;

  if (!pseudo || pseudo.length < 3) {
    return res.status(400).json({ erreur: "Pseudo invalide" });
  }

  try {
    // ── Charger le joueur ──
    // On ne sélectionne QUE les champs publics (pas d'email, pas de dernierPack)
    const joueur = await prisma.joueur.findUnique({
      where: { pseudo },
      select: {
        id: true,
        pseudo: true,
        dateInscription: true,
      },
    });

    if (!joueur) {
      return res.status(404).json({ erreur: "Joueur introuvable" });
    }

    // ── Stats de la collection ──
    const totalMots = await prisma.inventaire.count({
      where: { joueurId: joueur.id },
    });

    const parTier = await prisma.$queryRaw`
      SELECT m.tier, COUNT(*)::int as nb
      FROM inventaire i
      JOIN mots m ON m.id = i."motId"
      WHERE i."joueurId" = ${joueur.id}
      GROUP BY m.tier
      ORDER BY m.tier
    `;

    const stats = { tier1: 0, tier2: 0, tier3: 0 };
    for (const row of parTier) {
      stats[`tier${row.tier}`] = row.nb;
    }

    // ── Mots en vente sur le marché ──
    const enVente = await prisma.marche.count({
      where: { vendeurId: joueur.id },
    });

    // ── Mots les plus prestigieux (top 10 par fréquence) ──
    // Ces mots serviront de "vitrine" par défaut si le joueur
    // n'a pas configuré sa propre sélection
    const vitrine = await prisma.inventaire.findMany({
      where: { joueurId: joueur.id },
      take: 10,
      orderBy: { mot: { frequence: "desc" } },
      include: {
        mot: {
          select: {
            id: true,
            mot: true,
            tier: true,
            categorie: true,
            longueur: true,
            frequence: true,
          },
        },
      },
    });

    // ── Plus récentes acquisitions (top 5) ──
    const recents = await prisma.inventaire.findMany({
      where: { joueurId: joueur.id },
      take: 5,
      orderBy: { obtenuLe: "desc" },
      include: {
        mot: {
          select: {
            id: true,
            mot: true,
            tier: true,
            frequence: true,
          },
        },
      },
    });

    // ── Réponse ──
    res.json({
      joueur: {
        pseudo: joueur.pseudo,
        dateInscription: joueur.dateInscription,
      },
      stats: {
        totalMots,
        parTier: stats,
        enVente,
      },
      vitrine: vitrine.map((e) => ({
        id: e.mot.id,
        mot: e.mot.mot,
        tier: e.mot.tier,
        categorie: e.mot.categorie,
        longueur: e.mot.longueur,
        frequence: e.mot.frequence,
        obtenuLe: e.obtenuLe,
      })),
      acquisitionsRecentes: recents.map((e) => ({
        mot: e.mot.mot,
        tier: e.mot.tier,
        frequence: e.mot.frequence,
        obtenuLe: e.obtenuLe,
      })),
    });
  } catch (err) {
    console.error("Erreur GET /api/profil/:pseudo :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

export default router;
