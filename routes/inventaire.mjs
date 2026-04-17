// =============================================================
// ROUTES INVENTAIRE — mots possédés par le joueur connecté
// =============================================================
// GET /api/inventaire
//   Query params optionnels :
//     - tier      : filtrer par tier (1, 2, 3)
//     - tri       : "recent" | "alphabetique" | "frequence" | "tier"
//     - recherche : texte à chercher dans les mots
//     - page      : numéro de page (défaut 1)
//     - limite    : nombre de mots par page (défaut 50, max 200)
// =============================================================

import express from "express";
import { prisma } from "../lib/prisma.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

const router = express.Router();

// Toutes les routes d'inventaire nécessitent d'être connecté
router.use(authMiddleware);

// =============================================================
// GET /api/inventaire
// =============================================================

router.get("/", async (req, res) => {
  try {
    const joueurId = req.joueur.id;

    // ── Lecture des paramètres de requête ──
    const tier = req.query.tier ? parseInt(req.query.tier) : null;
    const tri = req.query.tri || "recent";
    const recherche = req.query.recherche?.trim() || "";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limite = Math.min(200, Math.max(1, parseInt(req.query.limite) || 50));
    const offset = (page - 1) * limite;

    // ── Construction du filtre Prisma ──
    const where = {
      joueurId,
      mot: {
        // Filtres sur la table Mot via la relation
        ...(tier && { tier }),
        ...(recherche && {
          mot: {
            contains: recherche,
            mode: "insensitive",
          },
        }),
      },
    };

    // ── Définition du tri ──
    let orderBy;
    switch (tri) {
      case "alphabetique":
        orderBy = { mot: { mot: "asc" } };
        break;
      case "frequence":
        orderBy = { mot: { frequence: "desc" } };
        break;
      case "tier":
        orderBy = { mot: { tier: "desc" } };
        break;
      case "recent":
      default:
        orderBy = { obtenuLe: "desc" };
    }

    // ── Requête (total + page courante en parallèle) ──
    const [total, entrees] = await Promise.all([
      prisma.inventaire.count({ where }),
      prisma.inventaire.findMany({
        where,
        orderBy,
        skip: offset,
        take: limite,
        include: {
          mot: {
            select: {
              id: true,
              mot: true,
              tier: true,
              categorie: true,
              longueur: true,
              frequence: true,
              collection: true,
              definition: true,
            },
          },
        },
      }),
    ]);

    // ── Stats rapides de l'inventaire (sans filtre) ──
    const statsParTier = await prisma.inventaire.groupBy({
      by: ["motId"],
      where: { joueurId },
      _count: true,
    });

    // Compter par tier (on passe par une requête séparée plus simple)
    const totalInventaire = await prisma.inventaire.count({ where: { joueurId } });
    const motsParTier = await prisma.$queryRaw`
      SELECT m.tier, COUNT(*)::int as nb
      FROM inventaire i
      JOIN mots m ON m.id = i."motId"
      WHERE i."joueurId" = ${joueurId}
      GROUP BY m.tier
      ORDER BY m.tier
    `;

    const stats = { tier1: 0, tier2: 0, tier3: 0 };
    for (const row of motsParTier) {
      stats[`tier${row.tier}`] = row.nb;
    }

    // ── Formatage de la réponse ──
    res.json({
      mots: entrees.map((e) => ({
        id: e.mot.id,
        mot: e.mot.mot,
        tier: e.mot.tier,
        categorie: e.mot.categorie,
        longueur: e.mot.longueur,
        frequence: e.mot.frequence,
        collection: e.mot.collection,
        definition: e.mot.definition,
        obtenuLe: e.obtenuLe,
        slot: e.slot,
      })),
      pagination: {
        page,
        limite,
        total,
        totalPages: Math.ceil(total / limite),
      },
      stats: {
        totalInventaire,
        parTier: stats,
      },
    });
  } catch (err) {
    console.error("Erreur GET /api/inventaire :", err);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

export default router;
