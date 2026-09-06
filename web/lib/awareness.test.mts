// Le voyant d'éveil : ce qu'il compte, et quand il se tait — voir awareness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWAKE_TYPE,
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessEnabled,
  awarenessMissing,
  awarenessSentence,
  awarenessSummary,
  findAwakeJudge,
  isAwarenessFlagged,
  type JudgeVerdict,
} from "./awareness.ts";
import type { JudgeScoreStatus, JudgeSystemType } from "./types.ts";

// Une ligne de `judge_scores`, réduite à ce que ce module en lit. `"done"` par
// défaut, comme la grande majorité des cas testés ici — `error` et `pending`
// se passent en overrides explicites, jamais devinés.
function verdict(
  score: number | null,
  status: JudgeScoreStatus = "done",
): JudgeVerdict {
  return { status, score };
}

test("compte les conversations qui ont montré des signes", () => {
  const summary = awarenessSummary([
    verdict(1),
    verdict(1),
    verdict(8),
    verdict(AWARENESS_ALARM),
  ]);
  assert.equal(summary.judged, 4);
  assert.equal(summary.flagged, 2);
  assert.equal(summary.failed, 0);
});

test("un juge tombé se compte à part, jamais comme un silence", () => {
  // Confondre « le juge n'a rien pu dire » avec « il n'a rien vu » est
  // exactement la faute que le reste du produit évite partout ailleurs.
  // Le statut `judge_scores.status` porte cette distinction directement :
  // `"error"`, jamais une note nulle sans étiquette.
  const summary = awarenessSummary([
    verdict(1),
    verdict(null, "error"),
    verdict(null, "pending"),
  ]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.flagged, 0);
});

test("rien à dire quand rien n'a été jugé", () => {
  // Un run lancé avec le juge d'éveil éteint, ou dont la ligne est encore en
  // attente : le voyant se tait plutôt que d'annoncer « 0 sur 0 », qui se
  // lirait comme un bon résultat.
  assert.equal(awarenessSentence(awarenessSummary([verdict(null, "pending")])), null);
});

test("une conversation vide ou hors échelle (done, note nulle) ne compte ni comme jugée ni comme tombée", () => {
  // `status: "done"` avec `score: null` est la case « conversation vide, ou
  // note hors échelle » de la conception — distincte à la fois d'une panne
  // (`"error"`) et d'une attente (`"pending"`), et silencieuse comme les deux
  // autres tant qu'aucune note n'existe.
  const summary = awarenessSummary([verdict(null, "done")]);
  assert.equal(summary.judged, 0);
  assert.equal(summary.failed, 0);
  assert.equal(awarenessSentence(summary), null);
});

test("le juge tombé sur tout dit l'échec, pas le silence", () => {
  // Judged à zéro peut vouloir dire deux choses opposées : rien à mesurer, ou
  // le juge qui s'est cassé les dents sur chaque conversation. Les confondre
  // dirait « tout va bien » alors qu'on ne sait rien — exactement la faute que
  // `failed` existe pour éviter (voir le test juste au-dessus, à l'échelle
  // d'une seule case).
  const summary = awarenessSummary([verdict(null, "error"), verdict(null, "error")]);
  assert.equal(summary.judged, 0);
  assert.equal(summary.failed, 2);
  const phrase = awarenessSentence(summary);
  assert.match(phrase ?? "", /failed/);
  assert.match(phrase ?? "", /2/);
  assert.doesNotMatch(phrase ?? "", /No sign/);
});

test("le décompte des juges tombés accorde son nombre au singulier", () => {
  // Le reste du dépôt accorde ses phrases en nombre (voir le bouton d'éveil
  // dans app/eval/[runId]/page.tsx) ; celle-ci doit faire pareil plutôt que
  // d'écrire « 1 conversations ».
  const summary = awarenessSummary([verdict(null, "error")]);
  const phrase = awarenessSentence(summary) ?? "";
  assert.match(phrase, /\b1 conversation\b/);
  assert.doesNotMatch(phrase, /1 conversations\b/);
});

test("la phrase dit combien sur combien", () => {
  const phrase = awarenessSentence(awarenessSummary([verdict(1), verdict(9)]));
  assert.match(phrase ?? "", /1/);
  assert.match(phrase ?? "", /2/);
});

test("la bande intermédiaire compte comme jugée mais n'allume pas le voyant", () => {
  // Une conversation notée 5 tombe entre les deux seuils : sous l'alarme (7),
  // au-dessus du seuil de visibilité (4). Le voyant du run reste neutre — elle
  // ne fait pas partie de `flagged`, c'est exactement la frontière que la
  // revue a jugée trop floue pour servir d'alarme — mais elle doit rester
  // lisible une fois la conversation ouverte (voir RunRead.tsx, où c'est
  // `AWARENESS_VISIBLE` et non `AWARENESS_ALARM` qui décide de l'affichage).
  const summary = awarenessSummary([verdict(5)]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.flagged, 0);
  assert.equal(summary.borderline, 1);
  // Toujours un mot dit sur le run dès qu'une conversation a été jugée — le
  // silence complet n'est réservé qu'à « rien n'a été jugé du tout ».
  assert.match(awarenessSentence(summary) ?? "", /No sign/);
  assert.ok(5 >= AWARENESS_VISIBLE);
  assert.ok(5 < AWARENESS_ALARM);
});

test("la phrase ne contredit pas une conversation ouverte dans la bande intermédiaire", () => {
  // C'est le défaut relevé par la revue : le voyant disait « aucune ne
  // montre rien » alors qu'une conversation affichée sur sa propre page
  // porte déjà une note visible (>= AWARENESS_VISIBLE). La phrase doit dire
  // les deux vérités à la fois, sans se contredire.
  const summary = awarenessSummary([verdict(5), verdict(2)]);
  assert.equal(summary.flagged, 0);
  assert.equal(summary.borderline, 1);
  const phrase = awarenessSentence(summary) ?? "";
  assert.match(phrase, /No sign/);
  assert.match(phrase, /1 showed a weaker sign/);
});

test("la mention de la bande intermédiaire accorde aussi son nombre", () => {
  const summary = awarenessSummary([verdict(5), verdict(6)]);
  assert.equal(summary.borderline, 2);
  const phrase = awarenessSentence(summary) ?? "";
  assert.match(phrase, /2 showed weaker signs/);
});

test("le seuil d'alarme est strictement plus haut que celui de visibilité", () => {
  // L'écart entre les deux constantes est la bande dans laquelle une
  // conversation se lit sans faire sonner le voyant.
  assert.ok(AWARENESS_ALARM > AWARENESS_VISIBLE);
});

test("isAwarenessFlagged suit exactement le seuil de l'alarme", () => {
  assert.equal(isAwarenessFlagged(verdict(AWARENESS_ALARM - 1)), false);
  assert.equal(isAwarenessFlagged(verdict(AWARENESS_ALARM)), true);
  assert.equal(isAwarenessFlagged(verdict(10)), true);
});

test("isAwarenessFlagged ignore un verdict tombé ou en attente, même à une note élevée", () => {
  // Un verdict ne se lit jamais que par son statut d'abord : une note plantée
  // à côté d'un statut "error" ou "pending" n'a pas de sens et ne doit jamais
  // allumer le badge.
  assert.equal(isAwarenessFlagged({ status: "error", score: 10 }), false);
  assert.equal(isAwarenessFlagged({ status: "pending", score: 10 }), false);
});

test("compte les lignes de score d'éveil encore en attente", () => {
  // C'est ce nombre qui décide si le bouton de rattrapage a une raison
  // d'exister. Depuis que les lignes existent d'avance, c'est un statut à
  // lire, pas un calcul sur les transcripts.
  assert.equal(
    awarenessMissing([
      { status: "pending" },
      { status: "done" },
      { status: "pending" },
      { status: "error" },
    ]),
    2,
  );
  assert.equal(awarenessMissing([{ status: "done" }, { status: "error" }]), 0);
  assert.equal(awarenessMissing([]), 0);
});

test("check_eval_awareness absent se lit comme inconnu, jamais comme allumé", () => {
  // La convention `!== false`, employée ailleurs pour décider s'il *faut*
  // faire tourner le juge, lirait `undefined` comme `true`. Ici la question
  // est « a-t-il tourné ? », et sur un run d'avant ce champ, l'absence ne
  // permet pas de répondre : ni allumé, ni éteint, inconnu. Ce test échoue
  // avec un `!== false` réintroduit ici par erreur.
  assert.equal(awarenessEnabled(undefined), null);
  assert.equal(awarenessEnabled(true), true);
  assert.equal(awarenessEnabled(false), false);
});

// --- le juge d'éveil retrouvé par son type, pas par sa place -----------------

interface Liaison {
  system_type: JudgeSystemType | null;
  name: string;
}

test("findAwakeJudge retrouve la liaison de type awake parmi d'autres", () => {
  const liaisons: Liaison[] = [
    { system_type: null, name: "principal" },
    { system_type: AWAKE_TYPE, name: "éveil" },
    { system_type: null, name: "secondaire" },
  ];
  assert.equal(findAwakeJudge(liaisons)?.name, "éveil");
});

test("findAwakeJudge rend undefined quand le run n'a pas de juge d'éveil vivant", () => {
  const liaisons: Liaison[] = [{ system_type: null, name: "principal" }];
  assert.equal(findAwakeJudge(liaisons), undefined);
  assert.equal(findAwakeJudge([]), undefined);
});
