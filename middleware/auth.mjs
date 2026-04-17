// =============================================================
// MIDDLEWARE D'AUTHENTIFICATION
// =============================================================
// S'applique sur toutes les routes protégées.
//
// Workflow :
//   1. Lit le header "Authorization: Bearer <token>"
//   2. Demande à Supabase de vérifier le token
//   3. Charge le joueur correspondant dans notre BDD Prisma
//   4. Attache req.user (Supabase) et req.joueur (Prisma) aux requêtes
//
// Usage dans les routes :
//   app.get("/api/protected", authMiddleware, (req, res) => {
//     console.log(req.joueur.pseudo);
//   });
// =============================================================

import { supabase } from "../lib/supabase.mjs";
import { prisma } from "../lib/prisma.mjs";

export async function authMiddleware(req, res, next) {
  try {
    // 1. Récupérer le token dans le header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        erreur: "Token manquant",
        detail: "Ajoute un header 'Authorization: Bearer <token>'",
      });
    }

    const token = authHeader.substring(7); // Retire "Bearer "

    // 2. Vérifier le token auprès de Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        erreur: "Token invalide ou expiré",
        detail: error?.message,
      });
    }

    // 3. Charger le joueur correspondant dans notre BDD
    const joueur = await prisma.joueur.findUnique({
      where: { id: user.id }, // L'id Supabase = l'id joueur (UUID)
    });

    if (!joueur) {
      return res.status(404).json({
        erreur: "Profil joueur introuvable",
        detail: "Le compte Supabase existe mais pas le profil. Réinscris-toi.",
      });
    }

    // 4. Attacher les infos à la requête
    req.user = user;      // User Supabase (email, metadata...)
    req.joueur = joueur;  // Joueur Prisma (pseudo, monnaie, inventaire...)

    next();
  } catch (err) {
    console.error("Erreur authMiddleware :", err);
    res.status(500).json({ erreur: "Erreur serveur lors de l'authentification" });
  }
}
