// Reconnaît les refus des deux fonctions RPC qui font vivre et mourir les
// liaisons de `run_judges` — `run_judges_unlink` et
// `run_judges_transfer_principal`, voir `unlinkJudge` et `designatePrincipal`
// dans runs.ts, les seules qui les appellent — ainsi que ceux du déclencheur
// différé qui les couvre. Le SQL exact et le sens de chaque message vivent
// dans .superpowers/sdd/fix-principal-rpc-report.md.
//
// Postgres répond en français, dans un texte destiné à une trace serveur ;
// ce qu'un appelant doit lire est en anglais, et dit quoi faire plutôt que de
// citer une contrainte. Reconnaître ces messages est la seule partie de ce
// geste qui ne parle pas au réseau — ce qui permet à ce fichier de tenir dans
// `node --test`, comme `mcp-budget.ts` à côté pour la même raison.
//
// Ne connaît ni `SupabaseError` ni les classes d'erreur exposées par
// `runs.ts` : c'est à l'appelant de choisir laquelle lever selon `kind`, ce
// fichier ne fait que classer un message.

/** `not_found` : l'identifiant visé (la liaison, ou son remplaçant) ne
 *  désigne rien de vivant sur ce run — introuvable, déjà délié, ou déjà
 *  délié pour le remplaçant. `principal_needs_replacement` : le refus
 *  spécifique du déclencheur différé, voir `unlinkJudge`. `invalid` :
 *  un couple d'arguments qui ne peut jamais réussir, quel que soit l'état de
 *  la base — remplaçant confondu avec la liaison qu'on délie. */
export type RunJudgesRefusalKind = "not_found" | "principal_needs_replacement" | "invalid";

export interface RunJudgesRefusal {
  kind: RunJudgesRefusalKind;
  /** Toujours en anglais : c'est ce texte, et rien du message Postgres
   *  d'origine, qui doit atteindre l'appelant. */
  message: string;
}

/** Classe un message d'erreur brut, tel que Postgres/PostgREST le rend pour
 *  `run_judges_unlink`, `run_judges_transfer_principal`, ou le déclencheur
 *  différé `run_judges_require_principal_trg` qui les couvre. `null` si rien
 *  n'est reconnu — l'appelant doit alors laisser passer l'erreur d'origine
 *  plutôt que d'en avaler une qu'il n'a pas su lire. */
export function classifyRunJudgesRefusal(rawMessage: string): RunJudgesRefusal | null {
  // Le déclencheur différé : on a délié le principal sans remplaçant valide
  // alors qu'il restait d'autres liaisons vivantes sur ce run. C'est le seul
  // refus que la base rend *au commit* plutôt qu'à l'appel de la fonction —
  // voir le commentaire au-dessus d'`unlinkJudge` dans runs.ts.
  if (/liaison\(s\) vivante\(s\) et aucune principale/.test(rawMessage)) {
    return {
      kind: "principal_needs_replacement",
      message:
        "This judge is the principal of this run, and other judges are still linked to it. " +
        "Designate a replacement principal first (or pass one directly to unlinkJudge) before " +
        "unlinking it — unless you mean to leave the run without any judge at all.",
    };
  }

  // `run_judges_unlink`, sur la liaison qu'on demande de délier.
  if (/est déjà déliée/.test(rawMessage)) {
    return { kind: "not_found", message: "This judge is already unlinked from this run." };
  }

  // `run_judges_transfer_principal`, sur la cible.
  if (/est une liaison supprimée ; elle ne peut pas devenir principale/.test(rawMessage)) {
    return {
      kind: "not_found",
      message:
        "This judge has already been unlinked from this run and cannot be made principal again.",
    };
  }

  // `run_judges_unlink`, sur le remplaçant proposé.
  if (/n'appartient pas au run/.test(rawMessage)) {
    return { kind: "not_found", message: "The replacement judge does not belong to this run." };
  }
  if (/est une liaison déjà supprimée/.test(rawMessage)) {
    return {
      kind: "not_found",
      message: "The replacement judge is already unlinked from this run.",
    };
  }

  // Les deux fonctions : la liaison visée (cible ou remplaçant) n'existe pas
  // du tout, ou existe mais sur un autre run que celui annoncé — même
  // message des deux côtés, voir le rapport de correction.
  if (/introuvable sur le run/.test(rawMessage)) {
    return { kind: "not_found", message: "This judge link does not exist on this run." };
  }

  // `run_judges_unlink` : le remplaçant proposé est la liaison qu'on délie.
  if (/ne peut pas être la liaison qu'on délie/.test(rawMessage)) {
    return {
      kind: "invalid",
      message: "The replacement judge cannot be the same link you are unlinking.",
    };
  }

  return null;
}
