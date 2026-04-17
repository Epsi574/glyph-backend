// =============================================================
// ROUTES MARCHÉ — ventes et achats de mots entre joueurs
// =============================================================
//
// GET    /api/marche              → liste publique des mots en vente
// POST   /api/marche/vendre       → mettre un mot en vente (auth)
// POST   /api/marche/acheter/:id  → acheter un mot (auth)
// DELETE /api/marche/annuler/:id  → retirer sa vente (auth)
// GET    /api/marche/mes-ventes   → ses propres ventes en cours (auth)
//
// =============================================================

import express from "express";
import { prisma } from "../lib/prisma.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

const router = express.Router();

// =============================================================
// CONFIGURATION
// =============================================================

const PRIX_MIN = 1;
const PRIX_MAX = 1_000_000;

// =============================================================
// GET /api/marche
// =============================================================
// Liste publique des mots en vente — pas besoin d'être connecté
// pour parcourir le marché.
//
// Query params :
//   - tier        : filtrer par tier (1, 2, 3)
//   - prixMin     : prix minimum
//   - prixMax     : prix maximum
//   - recherche   : texte à chercher dans le mot
//   - tri         : "recent" | "prix_asc" | "prix_desc" | "frequence"
//   - page        : défaut 1
//   - limite      : défaut 30, max 100
// =============================================================

router.get("/", async (req, res) => {
  try {
    const tier = req.query.tier ? parseInt(req.query.tier) : null;
    const prixMin = req.query.prixMin ? parseInt(req.query.prixMin) : null;
    const prixMax = req.query.prixMax ? parseInt(req.query.prixMax) : null;
    const recherche = req.query.recherche?.trim() || "";
    const tri = req.query.tri || "recent";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite) || 30));

    // ── Construction du filtre ──
    const where = {
      ...(prixMin !== null && { prix: { gte: prixMin } }),
      ...(prixMax !== null && { prix: { ...(prixMin !== null && { gte: prixMin }), lte: prixMax } }),
      mot: {
        ...(tier && { tier }),
        ...(recherche && {
          mot: { contains: recherche, mode: "insensitive" },
        }),
      },
    };

    // ── Tri ──
    let orderBy;
    switch (tri) {
      case "prix_asc":
        orderBy = { prix: "asc" };
        break;
      case "prix_desc":
        orderBy = { prix: "desc" };
        break;
      case "frequence":
        orderBy = { mot: { frequence: "desc" } };
        break;
      case "recent":
      default:
        orderBy = { dateMiseEnVente: "desc" };
    }

    const [total, ventes] = await Promise.all([
      prisma.marche.count({ where }),
      prisma.marche.findMany({
        where,
        orderBy,
        skip: (page - 1) * limite,
        take: limite,
        include: {
          mot: {
            select: {
              id: true, mot: true, tier: true, categorie: true,
              longueur: true, frequence: true, collection: true,
            },
          },
          vendeur: {
            select: { id: true, pseudo: true },
          },
        },
      }),
    ]);

    res.json({
      ventes: ventes.map((v) => ({
        id: v.id,
        prix: v.prix,
        dateMiseEnVente: v.dateMiseEnVente,
        mot: v.mot,
        vendeur: v.vendeur,
      })),
      pagination: {
        page,
        limite,
        total,
        totalPages: Math.ceil(total / limite),
      },
    });
  } catch (err) {
    console.error("Erreur GET /api/marche :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

// =============================================================
// GET /api/marche/mes-ventes
// =============================================================
// Les ventes en cours du joueur connecté
// (à placer AVANT les routes avec :id sinon conflit de routing)
// =============================================================

router.get("/mes-ventes", authMiddleware, async (req, res) => {
  try {
    const ventes = await prisma.marche.findMany({
      where: { vendeurId: req.joueur.id },
      orderBy: { dateMiseEnVente: "desc" },
      include: {
        mot: {
          select: {
            id: true, mot: true, tier: true,
            frequence: true, longueur: true,
          },
        },
      },
    });

    res.json({
      ventes: ventes.map((v) => ({
        id: v.id,
        prix: v.prix,
        dateMiseEnVente: v.dateMiseEnVente,
        mot: v.mot,
      })),
    });
  } catch (err) {
    console.error("Erreur GET /api/marche/mes-ventes :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

// =============================================================
// POST /api/marche/vendre
// =============================================================
// Body : { motId, prix }
//
// Workflow :
//   1. Vérifier que le joueur possède bien ce mot (inventaire)
//   2. Vérifier que le prix est valide
//   3. Transaction : retirer de l'inventaire + ajouter au marché
// =============================================================

router.post("/vendre", authMiddleware, async (req, res) => {
  const { motId, prix } = req.body;
  const joueurId = req.joueur.id;

  // ── Validation ──
  const motIdInt = parseInt(motId);
  const prixInt = parseInt(prix);

  if (!motIdInt || isNaN(motIdInt)) {
    return res.status(400).json({ erreur: "motId invalide" });
  }
  if (!prixInt || isNaN(prixInt) || prixInt < PRIX_MIN || prixInt > PRIX_MAX) {
    return res.status(400).json({
      erreur: `Le prix doit être entre ${PRIX_MIN} et ${PRIX_MAX} pièces`,
    });
  }

  try {
    // ── Vérifier que le joueur possède bien ce mot ──
    const entreeInventaire = await prisma.inventaire.findUnique({
      where: { motId: motIdInt },
      include: { mot: { select: { mot: true, tier: true } } },
    });

    if (!entreeInventaire) {
      return res.status(404).json({ erreur: "Ce mot n'est pas possédé" });
    }

    if (entreeInventaire.joueurId !== joueurId) {
      return res.status(403).json({ erreur: "Ce mot ne t'appartient pas" });
    }

    // ── Transaction : supprimer de l'inventaire + créer l'annonce ──
    const vente = await prisma.$transaction(async (tx) => {
      await tx.inventaire.delete({
        where: { motId: motIdInt },
      });

      return await tx.marche.create({
        data: {
          vendeurId: joueurId,
          motId: motIdInt,
          prix: prixInt,
        },
        include: {
          mot: { select: { id: true, mot: true, tier: true, frequence: true } },
        },
      });
    });

    res.status(201).json({
      succes: true,
      vente: {
        id: vente.id,
        prix: vente.prix,
        dateMiseEnVente: vente.dateMiseEnVente,
        mot: vente.mot,
      },
    });
  } catch (err) {
    console.error("Erreur POST /api/marche/vendre :", err);

    // Mot déjà en vente (contrainte unique sur motId dans marche)
    if (err.code === "P2002") {
      return res.status(409).json({ erreur: "Ce mot est déjà en vente" });
    }

    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

// =============================================================
// POST /api/marche/acheter/:id
// =============================================================
// Achète l'annonce #:id
//
// Workflow atomique :
//   1. Vérifier que l'annonce existe encore
//   2. Vérifier que l'acheteur n'est pas le vendeur
//   3. Vérifier que l'acheteur a assez de monnaie
//   4. Transaction :
//      - Débiter l'acheteur
//      - Créditer le vendeur
//      - Transférer le mot dans l'inventaire de l'acheteur
//      - Enregistrer la transaction
//      - Supprimer l'annonce
// =============================================================

router.post("/acheter/:id", authMiddleware, async (req, res) => {
  const venteId = parseInt(req.params.id);
  const acheteurId = req.joueur.id;

  if (!venteId || isNaN(venteId)) {
    return res.status(400).json({ erreur: "ID d'annonce invalide" });
  }

  try {
    // ── Charger l'annonce ──
    const vente = await prisma.marche.findUnique({
      where: { id: venteId },
      include: { mot: true },
    });

    if (!vente) {
      return res.status(404).json({ erreur: "Cette annonce n'existe plus" });
    }

    // ── Pas d'auto-achat ──
    if (vente.vendeurId === acheteurId) {
      return res.status(400).json({ erreur: "Tu ne peux pas acheter ton propre mot" });
    }

    // ── Vérifier la monnaie ──
    if (req.joueur.monnaie < vente.prix) {
      return res.status(402).json({
        erreur: "Monnaie insuffisante",
        detail: `Il te manque ${vente.prix - req.joueur.monnaie} pièces`,
      });
    }

    // ── Transaction atomique ──
    const resultat = await prisma.$transaction(async (tx) => {
      // Débiter l'acheteur
      const acheteurMaj = await tx.joueur.update({
        where: { id: acheteurId },
        data: { monnaie: { decrement: vente.prix } },
      });

      // Créditer le vendeur
      await tx.joueur.update({
        where: { id: vente.vendeurId },
        data: { monnaie: { increment: vente.prix } },
      });

      // Transférer le mot dans l'inventaire de l'acheteur
      await tx.inventaire.create({
        data: {
          joueurId: acheteurId,
          motId: vente.motId,
        },
      });

      // Enregistrer la transaction (historique)
      await tx.transaction.create({
        data: {
          acheteurId,
          vendeurId: vente.vendeurId,
          motId: vente.motId,
          prix: vente.prix,
        },
      });

      // Supprimer l'annonce
      await tx.marche.delete({ where: { id: venteId } });

      return acheteurMaj;
    });

    res.json({
      succes: true,
      mot: {
        id: vente.mot.id,
        mot: vente.mot.mot,
        tier: vente.mot.tier,
        frequence: vente.mot.frequence,
      },
      prixPaye: vente.prix,
      monnaie: resultat.monnaie,
    });
  } catch (err) {
    console.error("Erreur POST /api/marche/acheter/:id :", err);

    // Race : quelqu'un d'autre a acheté entre temps
    if (err.code === "P2025" || err.code === "P2002") {
      return res.status(409).json({
        erreur: "Ce mot vient d'être acheté ou retiré",
        detail: "Rafraîchis la liste",
      });
    }

    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

// =============================================================
// DELETE /api/marche/annuler/:id
// =============================================================
// Retire une annonce et remet le mot dans l'inventaire du vendeur
// =============================================================

router.delete("/annuler/:id", authMiddleware, async (req, res) => {
  const venteId = parseInt(req.params.id);
  const joueurId = req.joueur.id;

  if (!venteId || isNaN(venteId)) {
    return res.status(400).json({ erreur: "ID d'annonce invalide" });
  }

  try {
    const vente = await prisma.marche.findUnique({
      where: { id: venteId },
    });

    if (!vente) {
      return res.status(404).json({ erreur: "Cette annonce n'existe plus" });
    }

    if (vente.vendeurId !== joueurId) {
      return res.status(403).json({ erreur: "Cette annonce ne t'appartient pas" });
    }

    // ── Transaction : supprimer l'annonce + remettre en inventaire ──
    await prisma.$transaction(async (tx) => {
      await tx.marche.delete({ where: { id: venteId } });

      await tx.inventaire.create({
        data: {
          joueurId,
          motId: vente.motId,
        },
      });
    });

    res.json({ succes: true, message: "Annonce annulée, mot remis en inventaire" });
  } catch (err) {
    console.error("Erreur DELETE /api/marche/annuler/:id :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

export default router;
