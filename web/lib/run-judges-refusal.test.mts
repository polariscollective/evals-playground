// Classe les refus des deux fonctions RPC de `run_judges`, sans Supabase :
// voir run-judges-refusal.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRunJudgesRefusal } from "./run-judges-refusal.ts";

// The messages below are the exact ones the deferred trigger and the two RPC
// functions return. They stay in French on purpose: they are written that way
// in the SQL, in the polaris-supabase repository, and a translated fixture
// would stop matching what Postgres actually says — see
// .superpowers/sdd/fix-principal-rpc-report.md pour le SQL qui les produit.

test("the deferred trigger (unlinking the principal with no replacement) becomes a readable refusal", () => {
  const refusal = classifyRunJudgesRefusal(
    "run 3fa85f64-5717-4562-b3fc-2c963f66afa6 a 1 liaison(s) vivante(s) et aucune principale",
  );
  assert.equal(refusal?.kind, "principal_needs_replacement");
  assert.match(refusal!.message, /replacement principal/i);
  // The text returned to the caller is in English: never the original Postgres
  // message, nor a French fragment inside it.
  assert.doesNotMatch(refusal!.message, /liaison|principale|remplaçant/);
});

test("unlinking a link already unlinked becomes not-found", () => {
  const refusal = classifyRunJudgesRefusal("run_judge 111 est déjà déliée");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /already unlinked/i);
});

test("transferring the principal to a link already deleted becomes not-found", () => {
  const refusal = classifyRunJudgesRefusal(
    "run_judge 111 est une liaison supprimée ; elle ne peut pas devenir principale",
  );
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /cannot be made principal again/i);
});

test("a replacement from another run becomes not-found", () => {
  const refusal = classifyRunJudgesRefusal("le remplaçant 222 n'appartient pas au run 333");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /replacement judge does not belong/i);
});

test("a replacement already unlinked becomes not-found", () => {
  const refusal = classifyRunJudgesRefusal("le remplaçant 222 est une liaison déjà supprimée");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /replacement judge is already unlinked/i);
});

test("an unknown link or replacement becomes not-found", () => {
  const refusal = classifyRunJudgesRefusal("run_judge 444 introuvable sur le run 555");
  assert.equal(refusal?.kind, "not_found");
  assert.match(refusal!.message, /does not exist on this run/i);
});

test("naming the link being unlinked as the replacement is invalid", () => {
  const refusal = classifyRunJudgesRefusal(
    "le remplaçant ne peut pas être la liaison qu'on délie (666)",
  );
  assert.equal(refusal?.kind, "invalid");
  assert.match(refusal!.message, /cannot be the same link/i);
});

test("a message that does not come from these functions is not classified", () => {
  // Proof the function can fail: without the guard on the exact text, an
  // unrelated constraint (here a generic PostgREST foreign key) would be
  // wrongly recognised.
  assert.equal(
    classifyRunJudgesRefusal(
      'insert or update on table "run_judges" violates foreign key constraint',
    ),
    null,
  );
  assert.equal(classifyRunJudgesRefusal(""), null);
});

test("the last ordinary judge cannot be unlinked, and the sentence says what to do", () => {
  // The screen already refuses this gesture, but an MCP tool or a direct call
  // does not have that screen in front of it: the message must stand alone.
  const refus = classifyRunJudgesRefusal(
    "run 3f9 se retrouverait sans aucun juge ordinaire vivant",
  );
  assert.equal(refus?.kind, "last_ordinary_judge");
  // It says the order to follow — add then unlink — otherwise you are stuck
  // with no
  // savoir comment changer de juge.
  assert.match(refus?.message ?? "", /Add another judge first/);
  // And it says awareness does not count, otherwise you believe you can never
  // pouvoir le retirer.
  assert.match(refus?.message ?? "", /eval-awareness judge does not count/);
});

test("a system judge cannot become principal, and we say why", () => {
  const refus = classifyRunJudgesRefusal(
    "run_judge 7c1 est un juge système (awake) ; seul un juge ordinaire peut devenir principal",
  );
  assert.equal(refus?.kind, "system_judge_cannot_be_principal");
  // The reason counts as much as the refusal: its question and its scale do
  // not
  // sont pas celles du run, donc la matrice mentirait.
  assert.match(refus?.message ?? "", /own fixed question/);
});

test("no message returned to the caller cites an internal function name", () => {
  // An error message saying "pass it to unlinkJudge" speaks of a symbol
  // nobody outside this repository can see.
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
