import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { catalog } from "@/lib/catalog";
import { favoriteModels } from "@/lib/favorite-models";
import { ensureProfile } from "@/lib/profiles";

/** Le catalogue entier, marqué pour qui demande.
 *
 * Entier et non filtré : les écrans ont besoin des deux listes — ce qu'ils
 * proposent, et ce qu'ils affichent quand un run déjà lancé porte un modèle
 * qui a quitté les favoris. Filtrer ici obligerait un second aller-retour
 * pour retrouver le nom d'un modèle qu'on a sous les yeux.
 *
 * Un profil illisible ne fait pas échouer la route : `favoriteModels(null)`
 * rend le défaut du code. Ne pas savoir qui regarde n'est pas une raison de
 * ne rien proposer. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const profile = await ensureProfile(user.email).catch(() => null);
  return NextResponse.json(catalog(favoriteModels(profile)));
}
