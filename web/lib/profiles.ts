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
import { DEFAULT_ADVICE, type AdviceTopic } from "./advice";
import { PROFILES, SupabaseError, insert, select, update } from "./supabase";
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

/** Change les deux plafonds de `email`, depuis l'écran de profil — la
 *  seule écriture sur cette table hors de sa création.
 *
 * Ne valide rien : `capProblem`, dans `profile-caps.ts`, l'a déjà fait avant
 * d'arriver ici, côté route comme côté formulaire. Relit après coup plutôt
 * que de renvoyer ce qu'on vient d'écrire : `ensureProfile` est la seule
 * fonction qui sache encore faire exister la ligne si, par une course
 * improbable, elle avait disparu entre-temps. */
export async function updateProfileCaps(
  email: string,
  caps: { max_usd_per_run: number; max_usd_per_hour: number },
): Promise<Profile> {
  await update(PROFILES, caps, { user_email: `eq.${email}` });
  return ensureProfile(email);
}

/** Écrit — ou efface — la surcharge du conseil d'écriture de scénario.
 *
 * `null` remet le défaut. Une chaîne blanche, ou détourée égale au défaut,
 * est ramenée à `null` avant d'écrire : stocker du blanc, ou une copie du
 * défaut, ferait une surcharge qui existe sans rien dire — indistinguable à
 * la lecture d'un vrai texte pour `scenarioAdvice`, mais qui prive
 * silencieusement cette personne des améliorations futures du défaut. Le
 * détourage ne sert qu'à cette comparaison : un texte réellement différent
 * garde ses blancs internes, écrit tel quel.
 *
 * Ce filet existe en plus de celui de la page `/scenarios` : la route peut
 * être appelée sans passer par elle.
 *
 * Relit après coup pour la même raison qu'`updateProfileCaps` : `ensureProfile`
 * est la seule fonction qui sache refaire exister la ligne. */
export async function updateScenarioAdvice(
  email: string,
  advice: string | null,
): Promise<Profile> {
  return updateAdvice(email, "scenario", advice);
}

/** Écrit la surcharge d'UN document de conseil, depuis la page qui les édite.
 *
 * Écrire exactement le défaut vaut le remettre à `null` : le geste voulu est
 * « je n'ai rien à moi ici », et recopier le défaut dans la ligne priverait
 * cette personne de toute amélioration ultérieure sans qu'elle l'ait demandé.
 * Une chaîne blanche fait la même chose, et c'est le geste « remets le défaut »
 * à l'écran.
 *
 * Le sujet `scenario` écrit les DEUX colonnes : la neuve, et l'ancienne
 * `scenario_advice`, pour qu'un déploiement revenu en arrière ne perde pas le
 * texte. C'est la seule raison de garder l'ancienne à jour ; `overridesOf`
 * (`advice.ts`) la lit toujours en second. */
export async function updateAdvice(
  email: string,
  topic: AdviceTopic,
  advice: string | null,
): Promise<Profile> {
  const profile = await ensureProfile(email);
  const trimmed = advice?.trim() ?? "";
  const own =
    trimmed !== "" && trimmed !== DEFAULT_ADVICE[topic].trim() ? advice : null;

  const overrides: Record<string, string> = { ...(profile.advice_overrides ?? {}) };
  if (own === null) delete overrides[topic];
  else overrides[topic] = own;

  const patch: Record<string, unknown> = {
    // Un objet vide plutôt que `null` serait une surcharge qui ne surcharge
    // rien : `overridesOf` le lirait pareil, mais `null` dit ce qu'on veut dire.
    advice_overrides: Object.keys(overrides).length > 0 ? overrides : null,
  };
  if (topic === "scenario") patch.scenario_advice = own;

  await update(PROFILES, patch, { user_email: `eq.${email}` });
  return ensureProfile(email);
}

/** Écrit les favoris de `email`, depuis l'écran de profil.
 *
 * Ne valide rien : `favoritesProblem`, dans `favorite-models.ts`, l'a déjà
 * fait avant d'arriver ici, côté route comme côté formulaire.
 *
 * N'écrit jamais `null` : remettre le défaut se fait en cochant ce qu'on
 * veut, pas en vidant la liste — et une liste vide est refusée en amont. La
 * colonne ne redevient `null` que si personne n'y a jamais touché.
 *
 * Relit après coup pour la même raison qu'`updateProfileCaps` :
 * `ensureProfile` est la seule fonction qui sache refaire exister la ligne. */
export async function updateFavoriteModels(
  email: string,
  models: string[],
): Promise<Profile> {
  await update(PROFILES, { favorite_models: models }, { user_email: `eq.${email}` });
  return ensureProfile(email);
}
