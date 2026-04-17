// =============================================================
// CLIENT PRISMA PARTAGÉ
// =============================================================
// Un seul PrismaClient pour tout le serveur (pas un par fichier).
// Ça évite d'ouvrir trop de connexions PostgreSQL.
// =============================================================

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
