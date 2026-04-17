// =============================================================
// ROUTES D'AUTHENTIFICATION
// =============================================================
// POST /api/auth/register  → Inscription (crée Supabase + Joueur)
// POST /api/auth/login     → Connexion (retourne token JWT)
// POST /api/auth/logout    → Déconnexion
// GET  /api/auth/me        → Récupère le profil du joueur connecté
// =============================================================

import express from "express";
import { supabase } from "../lib/supabase.mjs";
import { prisma } from "../lib/prisma.mjs";
import { authMiddleware } from "../middleware/auth.mjs";

const router = express.Router();

// =============================================================
// POST /api/auth/register
// =============================================================
// Body : { email, password, pseudo }
//
// Crée un compte Supabase + un profil Joueur dans notre BDD.
// Les deux sont liés par le même UUID.
// =============================================================

router.post("/register", async (req, res) => {
  const { email, password, pseudo } = req.body;

  // ── Validation basique ──
  if (!email || !password || !pseudo) {
    return res.status(400).json({
      erreur: "Champs manquants",
      detail: "email, password et pseudo sont requis",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      erreur: "Mot de passe trop court (8 caractères minimum)",
    });
  }

  if (pseudo.length < 3 || pseudo.length > 20) {
    return res.status(400).json({
      erreur: "Le pseudo doit faire entre 3 et 20 caractères",
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(pseudo)) {
    return res.status(400).json({
      erreur: "Le pseudo ne peut contenir que des lettres, chiffres, - et _",
    });
  }

  // ── Vérifier que le pseudo n'est pas déjà pris ──
  const pseudoExistant = await prisma.joueur.findUnique({
    where: { pseudo },
  });
  if (pseudoExistant) {
    return res.status(409).json({ erreur: "Ce pseudo est déjà pris" });
  }

  // ── Créer le compte Supabase ──
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    // Erreurs courantes : email déjà utilisé, format invalide
    return res.status(400).json({
      erreur: "Inscription refusée",
      detail: error.message,
    });
  }

  if (!data.user) {
    return res.status(500).json({
      erreur: "Compte Supabase créé mais user absent de la réponse",
    });
  }

  // ── Créer le profil joueur dans notre BDD ──
  // L'id joueur = l'id Supabase (UUID)
  try {
    const joueur = await prisma.joueur.create({
      data: {
        id: data.user.id,
        email,
        pseudo,
        // monnaie: 100 → valeur par défaut dans le schema
      },
    });

    res.status(201).json({
      succes: true,
      message: data.session
        ? "Inscription réussie !"
        : "Inscription réussie ! Vérifie tes emails pour confirmer.",
      joueur: {
        id: joueur.id,
        pseudo: joueur.pseudo,
        email: joueur.email,
        monnaie: joueur.monnaie,
      },
      // La session existe uniquement si la confirmation email est désactivée
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      } : null,
    });
  } catch (err) {
    // Si la création du profil échoue, on devrait idéalement supprimer
    // le compte Supabase pour éviter un état incohérent.
    // Ici on signale juste l'erreur.
    console.error("Erreur création profil joueur :", err);
    res.status(500).json({
      erreur: "Compte créé mais erreur profil",
      detail: "Contacte le support",
    });
  }
});

// =============================================================
// POST /api/auth/login
// =============================================================
// Body : { email, password }
// Retourne : le token d'accès à utiliser dans les requêtes suivantes
// =============================================================

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      erreur: "email et password requis",
    });
  }

  // ── Tentative de connexion via Supabase ──
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({
      erreur: "Identifiants invalides",
      detail: error.message,
    });
  }

  // ── Charger le profil joueur ──
  const joueur = await prisma.joueur.findUnique({
    where: { id: data.user.id },
  });

  if (!joueur) {
    return res.status(404).json({
      erreur: "Profil introuvable",
      detail: "Le compte existe mais pas de profil joueur associé",
    });
  }

  res.json({
    succes: true,
    joueur: {
      id: joueur.id,
      pseudo: joueur.pseudo,
      email: joueur.email,
      monnaie: joueur.monnaie,
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    },
  });
});

// =============================================================
// POST /api/auth/logout
// =============================================================
// Nécessite un token valide.
// En pratique le client peut juste jeter le token côté frontend,
// mais cette route permet de révoquer la session côté Supabase.
// =============================================================

router.post("/logout", authMiddleware, async (req, res) => {
  const token = req.headers.authorization.substring(7);

  const { error } = await supabase.auth.admin?.signOut?.(token) ||
                    await supabase.auth.signOut();

  if (error) {
    return res.status(500).json({ erreur: "Déconnexion échouée", detail: error.message });
  }

  res.json({ succes: true, message: "Déconnecté" });
});

// =============================================================
// GET /api/auth/me
// =============================================================
// Retourne le profil du joueur actuellement connecté.
// Utile pour vérifier la validité du token côté frontend.
// =============================================================

router.get("/me", authMiddleware, async (req, res) => {
  res.json({
    joueur: {
      id: req.joueur.id,
      pseudo: req.joueur.pseudo,
      email: req.joueur.email,
      monnaie: req.joueur.monnaie,
      dateInscription: req.joueur.dateInscription,
      dernierPack: req.joueur.dernierPack,
    },
  });
});

export default router;
