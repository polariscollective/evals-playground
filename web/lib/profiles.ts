// Le profil d'une personne : ses deux plafonds de dépense par agent, propres
// à elle plutôt qu'à tout le monde — voir la migration `profiles` dans
// `polaris-supabase` pour pourquoi ce choix, et son prix assumé (plus de
// coupe-circuit global).
//
// Une seule fonction, `ensureProfile`, appelée par les deux portes qui
// établissent une identité authentifiée — `requireUser` côté web,
// `callerEmail` côté MCP — pour que le profil existe avant même qu'on en ait
// besoin : un agent qui n'a jamais ouvert l'écran ne doit pas découvrir
// l'absence de profil au moment où il tente de dépenser.
import "server-only";
import { PROFILES, SupabaseError, insert, select } from "./supabase";
import type { Profile } from "./types";

/** Le profil de `email`, créé aux défauts de la table s'il n'existait pas
 *  encore.
 *
 * Lit d'abord plutôt que d'insérer à l'aveugle : passé la première fois, le
 * cas courant ne coûte qu'une lecture. La clé primaire est l'adresse, donc
 * deux requêtes qui créent le même profil en même temps peuvent se
 * télescoper — l'une des deux insertions échoue alors avec une contrainte
 * violée. Ce n'est pas une erreur à remonter : le profil existe, c'est tout
 * ce qui compte, donc on relit plutôt que de propager l'échec de l'écriture.
 *
 * Ne lève que si le profil ne peut vraiment ni être lu ni être créé —
 * l'appelant en fait alors un refus de dépense, jamais un plafond deviné à
 * sa place. */
export async function ensureProfile(email: string): Promise<Profile> {
  const found = await select<Profile>(PROFILES, {
    user_email: `eq.${email}`,
    select: "*",
    limit: 1,
  });
  if (found[0]) return found[0];

  try {
    const created = await insert<Profile>(PROFILES, { user_email: email }, { returning: true });
    if (created[0]) return created[0];
  } catch (error) {
    // Course perdue contre une autre requête : l'adresse a déjà été prise
    // entre notre lecture et notre écriture. Pas une erreur — la ligne
    // existe, il suffit de la relire ci-dessous. Toute autre erreur
    // (connexion, droits) se retrouvera de toute façon dans la relecture qui
    // suit : si le profil n'y est pas non plus, elle finit par lever.
    if (!(error instanceof SupabaseError)) throw error;
  }

  const after = await select<Profile>(PROFILES, {
    user_email: `eq.${email}`,
    select: "*",
    limit: 1,
  });
  if (after[0]) return after[0];
  throw new SupabaseError(`Could not create or read a profile for ${email}.`);
}
