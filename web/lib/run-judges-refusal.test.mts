// Classe les refus des deux fonctions RPC de `run_judges`, sans Supabase :
// voir run-judges-refusal.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRunJudgesRefusal } from "./run-judges-refusal.ts";

// Les messages ci-dessous sont ceux, exacts, que rendent le déclencheur
// différé et les deux fonctions RPC — voir
// .superpowers/sdd/fix-principal-rpc-report.md pour le SQL qui les produit.

test("le déclencheur différé (délier le principal sans remplaçant) devient un refus lisible", () => {
  const refusal = classifyRunJudgesRefusal(
    "run 3fa85f64-5717-4562-b3fc-2c963f66afa6 a 1 liaison(s) vivante(s) et aucune principale",
  );
  assert.equal(refusal?.kind, "principal_needs_replacement");
  assert.match(refusal!.message, /replacement principal/i);
  // Le texte rendu à l'appelant est en anglais : jamais le message Postgres
  // d'origine, ni un fragment français dedans.
  assert.doesNotMatch(refusal!.message, /liaison|principale|remplaçant/);
});

test("délier une liaison déjà déliée devient introuvable", () => {
  const refusal = classifyRunJudgesRefusal("run_judge 111 est déjà déliée");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /already unlinked/i);
});

test("transférer le principal vers une liaison déjà supprimée devient introuvable", () => {
  const refusal = classifyRunJudgesRefusal(
    "run_judge 111 est une liaison supprimée ; elle ne peut pas devenir principale",
  );
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /cannot be made principal again/i);
});

test("un remplaçant d'un autre run devient introuvable", () => {
  const refusal = classifyRunJudgesRefusal("le remplaçant 222 n'appartient pas au run 333");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /replacement judge does not belong/i);
});

test("un remplaçant déjà délié devient introuvable", () => {
  const refusal = classifyRunJudgesRefusal("le remplaçant 222 est une liaison déjà supprimée");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /replacement judge is already unlinked/i);
});

test("une liaison ou un remplaçant inconnu devient introuvable", () => {
  const refusal = classifyRunJudgesRefusal("run_judge 444 introuvable sur le run 555");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /does not exist on this run/i);
});

test("désigner comme remplaçant la liaison qu'on délie est invalide", () => {
  const refusal = classifyRunJudgesRefusal(
    "le remplaçant ne peut pas être la liaison qu'on délie (666)",
  );
  assert.equal(refusal?.kind, "invalid");
  assert.match(refusal!.message, /cannot be the same link/i);
});

test("un message qui ne vient pas de ces fonctions n'est pas classé", () => {
  // Preuve que la fonction peut échouer : sans le garde-fou sur le texte
  // exact, une contrainte sans rapport (ici une clé étrangère générique de
  // PostgREST) se ferait reconnaître à tort.
  assert.equal(
    classifyRunJudgesRefusal(
      'insert or update on table "run_judges" violates foreign key constraint',
    ),
    null,
  );
  assert.equal(classifyRunJudgesRefusal(""), null);
});

test("le dernier juge ordinaire ne se délie pas, et la phrase dit quoi faire", () => {
  // L'écran refuse déjà ce geste, mais un outil MCP ou un appel direct n'a
  // pas cet écran devant lui : le message doit tenir tout seul.
  const refus = classifyRunJudgesRefusal(
    "run 3f9 se retrouverait sans aucun juge ordinaire vivant",
  );
  assert.equal(refus?.kind, "last_ordinary_judge");
  // Il dit l'ordre à suivre — ajouter puis délier — sinon on est bloqué sans
  // savoir comment changer de juge.
  assert.match(refus?.message ?? "", /Add another judge first/);
  // Et il dit que l'éveil ne compte pas, sinon on croit ne plus jamais
  // pouvoir le retirer.
  assert.match(refus?.message ?? "", /eval-awareness judge does not count/);
});

test("un juge système ne peut pas devenir principal, et on dit pourquoi", () => {
  const refus = classifyRunJudgesRefusal(
    "run_judge 7c1 est un juge système (awake) ; seul un juge ordinaire peut devenir principal",
  );
  assert.equal(refus?.kind, "system_judge_cannot_be_principal");
  // La raison compte autant que le refus : sa question et son échelle ne
  // sont pas celles du run, donc la matrice mentirait.
  assert.match(refus?.message ?? "", /own fixed question/);
});

test("aucun message rendu à l'appelant ne cite un nom de fonction interne", () => {
  // Un message d'erreur qui dit « passe-le à unlinkJudge » parle d'un
  // symbole que personne, hors de ce dépôt, ne peut voir.
  const messages = [
    "run 3f9 a encore des liaison(s) vivante(s) et aucune principale",
    "run_judge 7c1 est déjà déliée",
    "le remplaçant 9a2 n'appartient pas au run 3f9",
    "run 3f9 se retrouverait sans aucun juge ordinaire vivant",
  ].map((raw) => classifyRunJudgesRefusal(raw)?.message ?? "");
  for (const message of messages) {
    assert.doesNotMatch(message, /unlinkJudge|designatePrincipal|run_judges_/);
  }
});
