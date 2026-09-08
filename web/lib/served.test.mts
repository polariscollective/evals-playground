// Le voyant des résultats servis, et le croisement qui justifie de le
// construire. Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  argumentsKey,
  awarenessJoin,
  callsMade,
  servedSentence,
  servedSummary,
  unfaithfulCalls,
  type ToolResultRow,
} from "./served.ts";

const ligne = (extra: Partial<ToolResultRow> = {}): ToolResultRow => ({
  scenario_index: 0,
  tool_name: "search_files",
  arguments: { query: "Vandenberghe" },
  faithful: true,
  fault: "",
  check_error: null,
  ...extra,
});

const appel = (name: string, args: Record<string, unknown>) => ({
  role: "assistant",
  tool_calls: [{ name, arguments: args }],
});

// --- Les trois issues, jamais fondues ---------------------------------------

test("le voyant sépare conforme, fautif et pas encore contrôlé", () => {
  // « Pas encore contrôlé » n'est pas « conforme » : le contrôle n'y est pas
  // passé, il n'a rien dit. Les confondre ferait passer un run non vérifié
  // pour un run propre.
  const résumé = servedSummary([
    ligne(),
    ligne({ faithful: false, fault: "a inventé un fichier" }),
    ligne({ faithful: null }),
  ]);
  assert.deepEqual(résumé, {
    total: 3,
    unfaithful: 1,
    repaired: 0,
    sameFamily: 0,
    unchecked: 1,
    couldNotCheck: 0,
    lastCheckError: null,
  });
});

test("une tentative de contrôle échouée ne se confond pas avec un contrôle jamais tenté", () => {
  // Le premier sait qu'il ne sait pas et pourquoi ; le second n'a encore rien
  // dit du tout. Les fondre masquerait une clé morte chez le contrôleur
  // derrière un silence qui ressemble à du calme.
  const résumé = servedSummary([
    ligne({ faithful: null }),
    ligne({ faithful: null, check_error: "AuthenticationError: clé invalide" }),
    ligne({ faithful: null, check_error: "RateLimitError: quota dépassé" }),
  ]);
  assert.deepEqual(résumé, {
    total: 3,
    unfaithful: 0,
    repaired: 0,
    sameFamily: 0,
    unchecked: 1,
    couldNotCheck: 2,
    lastCheckError: "RateLimitError: quota dépassé",
  });
});

test("un run qui n'a rien servi n'a pas de voyant", () => {
  assert.equal(servedSentence(servedSummary([]), awarenessJoin([], [])), null);
});

// --- Rapprocher un transcript d'une ligne -----------------------------------

test("l'ordre des arguments ne sépare pas deux appels identiques", () => {
  assert.equal(argumentsKey({ a: 1, b: 2 }), argumentsKey({ b: 2, a: 1 }));
});

test("les appels se lisent sur les tours d'assistant, pas sur les tours d'outil", () => {
  // Un tour `tool` ne porte que ce qui a été rendu : il n'a pas les arguments,
  // et le compter doublerait chaque appel.
  const vus = callsMade(0, [
    appel("search_files", { query: "X" }),
    { role: "tool", tool_calls: null },
  ]);
  assert.equal(vus.size, 1);
});

test("deux scénarios ne partagent pas un appel", () => {
  // Le monde diffère par scénario : la même requête n'y a pas la même réponse.
  const première = callsMade(0, [appel("search_files", { query: "X" })]);
  const seconde = callsMade(1, [appel("search_files", { query: "X" })]);
  assert.notDeepEqual([...première], [...seconde]);
});

test("seuls les résultats jugés fautifs entrent dans l'ensemble", () => {
  const fautifs = unfaithfulCalls([
    ligne(),
    ligne({ faithful: null }),
    ligne({ arguments: { query: "X" }, faithful: false, fault: "à côté" }),
  ]);
  assert.equal(fautifs.size, 1);
});

// --- Le croisement ----------------------------------------------------------

const FAUTIF = ligne({
  arguments: { query: "X" },
  faithful: false,
  fault: "a répondu à côté",
});

test("une conversation éveillée qui a vu une faute est rapprochée des deux", () => {
  // C'est la réponse à « ce modèle est perspicace, ou avons-nous cassé le
  // décor ». Sans elle, on relit les transcripts un par un.
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [appel("search_files", { query: "X" })], awake: true }],
    [FAUTIF],
  );
  assert.deepEqual(join, { awake: 1, awakeAfterFault: 1, faultUnnoticed: 0 });
});

test("une conversation éveillée qui n'a rien vu de fautif reste inexpliquée", () => {
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [appel("search_files", { query: "Z" })], awake: true }],
    [FAUTIF],
  );
  assert.deepEqual(join, { awake: 1, awakeAfterFault: 0, faultUnnoticed: 0 });
});

test("une faute que personne n'a relevée est comptée aussi", () => {
  // Le run n'en est pas invalidé, mais on préfère le savoir : on a servi
  // n'importe quoi et le juge d'éveil n'a rien vu.
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [appel("search_files", { query: "X" })], awake: false }],
    [FAUTIF],
  );
  assert.deepEqual(join, { awake: 0, awakeAfterFault: 0, faultUnnoticed: 1 });
});

test("sans aucune faute, l'éveil se compte quand même", () => {
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [], awake: true }],
    [ligne()],
  );
  assert.equal(join.awake, 1);
  assert.equal(join.awakeAfterFault, 0);
});

// --- La phrase --------------------------------------------------------------

test("la phrase ne parle de fautes que s'il y en a", () => {
  const phrase = servedSentence(servedSummary([ligne(), ligne()]), awarenessJoin([], []));
  assert.match(phrase!, /2 tool results served/);
  assert.ok(!phrase!.includes("did not hold up"));
});

test("la phrase nomme le croisement quand il apprend quelque chose", () => {
  const samples = [
    { scenario_index: 0, transcript: [appel("search_files", { query: "X" })], awake: true },
  ];
  const rows = [FAUTIF, ligne()];
  const phrase = servedSentence(servedSummary(rows), awarenessJoin(samples, rows));
  assert.match(phrase!, /1 did not hold up/);
  assert.match(phrase!, /1 of the 1 conversations the awareness judge flagged saw one/);
});

test("la phrase dit aussi les fautes que personne n'a relevées", () => {
  const samples = [
    { scenario_index: 0, transcript: [appel("search_files", { query: "X" })], awake: false },
  ];
  const rows = [FAUTIF];
  const phrase = servedSentence(servedSummary(rows), awarenessJoin(samples, rows));
  assert.match(phrase!, /without the awareness judge noticing/);
});

test("sans croisement possible, la phrase se tait plutôt que d'annoncer zéro", () => {
  // Les transcripts ne sont chargés que sur demande. « 0 des 3 conversations
  // éveillées » se lirait « aucune » là où la vérité est « on ne sait pas ».
  const rows = [FAUTIF];
  const phrase = servedSentence(servedSummary(rows), null);
  assert.match(phrase!, /1 did not hold up/);
  assert.ok(!phrase!.includes("awareness judge"));
});

test("les lignes non contrôlées sont dites, pas tues", () => {
  const phrase = servedSentence(
    servedSummary([ligne(), ligne({ faithful: null })]),
    awarenessJoin([], []),
  );
  assert.match(phrase!, /1 not checked yet/);
});

test("les lignes qu'on n'a pas pu contrôler disent aussi pourquoi", () => {
  const phrase = servedSentence(
    servedSummary([
      ligne(),
      ligne({ faithful: null, check_error: "AuthenticationError: clé invalide" }),
    ]),
    awarenessJoin([], []),
  );
  assert.match(phrase!, /1 could not be checked \(AuthenticationError: clé invalide\)/);
  assert.ok(!phrase!.includes("not checked yet"));
});

test("servi malgré une réparation échouée est une issue à part", () => {
  // La cinquième, et ce produit n'en fond jamais deux. Elle reste un
  // sous-ensemble de `unfaithful` : la même ligne fautive, vue de plus près.
  const résumé = servedSummary([
    ligne({ faithful: false, fault: "a inventé", attempts: 2 }),
    ligne({ faithful: false, fault: "a inventé" }),
  ]);
  assert.equal(résumé.unfaithful, 2);
  assert.equal(résumé.repaired, 1);
});

test("un contrôleur de la famille du serveur se compte et se dit", () => {
  // Le repli du spec : mieux vaut un contrôleur au biais partagé que pas de
  // contrôle du tout, mais ça se sait plutôt que ça se devine.
  const résumé = servedSummary([
    ligne({
      model: "anthropic/claude-opus-5",
      check_model: "anthropic/claude-haiku-4-5",
    }),
    ligne({ model: "anthropic/claude-opus-5", check_model: "openai/gpt-5.6-luna" }),
  ]);
  assert.equal(résumé.sameFamily, 1);
  assert.match(
    servedSentence(résumé, null) ?? "",
    /checked by the world model's own family/,
  );
});

test("la réparation échouée se dit dans la clause de la faute", () => {
  // Pas dans une phrase à elle : c'est la même ligne, et l'annoncer à part la
  // ferait compter deux fois par qui lit vite.
  const phrase = servedSentence(
    servedSummary([ligne({ faithful: false, fault: "a inventé", attempts: 2 })]),
    null,
  );
  assert.match(phrase ?? "", /1 did not hold up \(1 after a failed repair\)/);
});
