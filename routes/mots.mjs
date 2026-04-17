// =============================================================
// ROUTES MOTS — recherche de mots dans le jeu
// =============================================================
// GET /api/mots/recherche?q=pantalon
//   Retourne le mot, son propriétaire actuel (s'il y en a un),
//   et depuis quand il le possède. Accessible sans auth.
// =============================================================

import express from "express";
import { prisma } from "../lib/prisma.mjs";

const router = express.Router();

router.get("/recherche", async (req, res) => {
  const q = req.query.q?.trim().toLowerCase();

  if (!q || q.length < 2) {
    return res.status(400).json({ erreur: "Recherche trop courte (2 caractères minimum)" });
  }

  try {
    // Chercher le mot exact d'abord, puis les mots qui contiennent la recherche
    const motExact = await prisma.mot.findUnique({
      where: { mot: q },
      include: {
        inventaire: {
          include: {
            joueur: {
              select: { pseudo: true },
            },
          },
        },
        marche: {
          include: {
            vendeur: {
              select: { pseudo: true },
            },
          },
        },
      },
    });

    // Chercher aussi les mots similaires (contiennent la recherche)
    const motsSimilaires = await prisma.mot.findMany({
      where: {
        mot: { contains: q, mode: "insensitive" },
        NOT: { mot: q }, // Exclure le mot exact (déjà affiché)
      },
      take: 10,
      orderBy: { frequence: "desc" },
      include: {
        inventaire: {
          include: {
            joueur: { select: { pseudo: true } },
          },
        },
        marche: {
          include: {
            vendeur: { select: { pseudo: true } },
          },
        },
      },
    });

    function formatMot(m) {
      let statut = "libre";
      let proprietaire = null;
      let depuisLe = null;
      let enVente = null;

      if (m.inventaire) {
        statut = "possédé";
        proprietaire = m.inventaire.joueur.pseudo;
        depuisLe = m.inventaire.obtenuLe;
      } else if (m.marche) {
        statut = "en vente";
        proprietaire = m.marche.vendeur.pseudo;
        enVente = { prix: m.marche.prix, depuis: m.marche.dateMiseEnVente };
      }

      return {
        id: m.id,
        mot: m.mot,
        tier: m.tier,
        categorie: m.categorie,
        longueur: m.longueur,
        frequence: m.frequence,
        statut,
        proprietaire,
        depuisLe,
        enVente,
      };
    }

    res.json({
      exact: motExact ? formatMot(motExact) : null,
      similaires: motsSimilaires.map(formatMot),
    });
  } catch (err) {
    console.error("Erreur GET /api/mots/recherche :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

export default router;
