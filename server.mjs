// =============================================================
// SERVEUR EXPRESS — Point d'entrée
// =============================================================

import "dotenv/config";
import express from "express";
import cors from "cors";

import { prisma } from "./lib/prisma.mjs";
import authRoutes from "./routes/auth.mjs";
import inventaireRoutes from "./routes/inventaire.mjs";
import packRoutes from "./routes/pack.mjs";
import profilRoutes from "./routes/profil.mjs";
import marcheRoutes from "./routes/marche.mjs";
import motsRoutes from "./routes/mots.mjs";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/inventaire", inventaireRoutes);
app.use("/api/pack", packRoutes);
app.use("/api/profil", profilRoutes);
app.use("/api/marche", marcheRoutes);
app.use("/api/mots", motsRoutes);

// =============================================================
// GET /api/stats — stats globales du jeu (publique)
// =============================================================

app.get("/api/stats", async (req, res) => {
  try {
    const total = await prisma.mot.count();
    const tier1 = await prisma.mot.count({ where: { tier: 1 } });
    const tier2 = await prisma.mot.count({ where: { tier: 2 } });
    const tier3 = await prisma.mot.count({ where: { tier: 3 } });
    const libres = await prisma.mot.count({
      where: { inventaire: null, marche: null },
    });
    const joueurs = await prisma.joueur.count();
    const ventesActives = await prisma.marche.count();

    res.json({
      mots: { total, tiers: { tier1, tier2, tier3 }, libres },
      joueurs,
      ventesActives,
    });
  } catch (err) {
    console.error("Erreur /api/stats :", err.message);
    res.status(500).json({ erreur: "Erreur serveur" });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎮 Serveur démarré sur http://localhost:${PORT}\n`);
  console.log(`   Routes publiques :`);
  console.log(`   → GET  /api/stats`);
  console.log(`   → GET  /api/profil/:pseudo`);
  console.log(`   → GET  /api/marche                       (parcourir les ventes)`);
  console.log(`\n   Authentification :`);
  console.log(`   → POST /api/auth/register`);
  console.log(`   → POST /api/auth/login`);
  console.log(`   → POST /api/auth/logout`);
  console.log(`   → GET  /api/auth/me`);
  console.log(`\n   Routes de jeu (auth requise) :`);
  console.log(`   → GET  /api/inventaire`);
  console.log(`   → GET  /api/pack/status`);
  console.log(`   → POST /api/pack/ouvrir`);
  console.log(`\n   Marché (auth requise) :`);
  console.log(`   → GET    /api/marche/mes-ventes`);
  console.log(`   → POST   /api/marche/vendre              (body: motId, prix)`);
  console.log(`   → POST   /api/marche/acheter/:id`);
  console.log(`   → DELETE /api/marche/annuler/:id`);
  console.log(`\n   Prisma Studio : npm run studio\n`);
});
