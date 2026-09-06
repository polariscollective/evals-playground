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
