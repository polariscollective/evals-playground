"use client";

// Les scénarios qu'on vient d'importer, tels qu'ils sont.
//
// Sans cette liste, on lance un run de quarante lignes après avoir vu trois
// mots de son contenu — un décompte et les trois premiers titres. Or un import
// se trompe silencieusement : une colonne décalée produit quarante scénarios
// parfaitement valides et complètement faux, et aucune validation ne peut le
// voir. Un œil le peut, en une seconde, si on lui montre les lignes.
//
// En lecture seule, et il ne connaît que ses scénarios : ni le CSV dont ils
// sortent, ni les colonnes choisies, ni de quoi écrire. Cette ignorance est le
// dessin — elle interdit qu'il modifie quoi que ce soit aujourd'hui, et le
// laisse réutilisable tel quel le jour où l'édition arrivera.
import { useState } from "react";
import { scenarioBadges } from "@/lib/scenario-summary";
import type { EvalScenario } from "@/lib/types";

/** Un texte et son étiquette, coupé tant que l'entrée est repliée.
 *
 * `SYS` et `MSG` portent tout le poids de la vérification : alignés sur
 * quarante lignes, un décalage de colonne saute aux yeux — un message
 * d'ouverture qui commence par « You are an assistant » ne se rate pas. */
function Field({
  label,
  text,
  open,
}: {
  label: string;
  text: string;
  open: boolean;
}) {
  // Des `span` et non des `div` : ce bloc vit à l'intérieur d'un `<button>`,
  // dont le contenu ne peut être que du contenu de phrase. Les classes `flex`
  // leur donnent la mise en page d'un bloc sans en être un.
  return (
    <span className="flex gap-2">
      <span className="mt-px shrink-0 font-mono text-[10px] tracking-wider text-zinc-400">
        {label}
      </span>
      <span
        className={`min-w-0 font-mono text-xs text-zinc-600 ${
          open ? "whitespace-pre-wrap" : "line-clamp-2"
        }`}
      >
        {text || <em className="text-amber-700 not-italic">— empty</em>}
      </span>
    </span>
  );
}

function Scenario({
  scenario,
  position,
}: {
  scenario: EvalScenario;
  position: number;
}) {
  const [open, setOpen] = useState(false);
  const badges = scenarioBadges(scenario);
  const history = scenario.history ?? [];

  return (
    <li className="border-b border-zinc-200 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer gap-2 p-2 text-left hover:bg-zinc-100"
      >
        <span className="w-6 shrink-0 text-right font-mono text-xs text-zinc-400">
          {position}
        </span>
        <span className="min-w-0 grow space-y-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">
              {scenario.title || (
                <em className="text-amber-700 not-italic">— untitled</em>
              )}
            </span>
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded bg-zinc-200 px-1.5 py-px text-[10px] text-zinc-600"
              >
                {badge}
              </span>
            ))}
          </span>
          <Field label="SYS" text={scenario.system_prompt} open={open} />
          <Field label="MSG" text={scenario.opening_message} open={open} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-200 bg-white p-2 pl-10 text-xs">
          {scenario.note?.trim() && (
            <div>
              <span className="font-medium text-zinc-500">
                Note — neither the model nor the judge sees it
              </span>
              <p className="whitespace-pre-wrap text-zinc-700">
                {scenario.note}
              </p>
            </div>
          )}
          {history.length > 0 && (
            <div>
              <span className="font-medium text-zinc-500">
                Prior history — given as already having happened
              </span>
              {history.map((turn, index) => (
                <p key={index} className="mt-1 flex gap-2">
                  <span className="shrink-0 font-mono text-[10px] tracking-wider text-zinc-400">
                    {turn.role === "user" ? "USER" : "ASST"}
                  </span>
                  <span className="whitespace-pre-wrap text-zinc-700">
                    {turn.content}
                  </span>
                </p>
              ))}
            </div>
          )}
          {/* Nommés, et non comptés : la pastille dit déjà combien, et devant
              une case surprenante c'est « lequel » qu'on veut savoir. */}
          {scenario.tools != null && scenario.tools.length > 0 && (
            <div>
              <span className="font-medium text-zinc-500">Tools offered</span>
              <p className="font-mono text-zinc-700">
                {scenario.tools.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ScenarioList({ scenarios }: { scenarios: EvalScenario[] }) {
  if (scenarios.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-700">
        {scenarios.length} scenario{scenarios.length > 1 ? "s" : ""} ready —
        click one to see it whole.
      </p>
      {/* Plafonnée et défilante : la liste sert à comprendre le run qu'on
          compose, et ne doit pas repousser le bouton de lancement hors de
          l'écran. */}
      <ul className="max-h-96 overflow-y-auto rounded border border-zinc-300 bg-zinc-50">
        {scenarios.map((scenario, index) => (
          <Scenario key={index} scenario={scenario} position={index + 1} />
        ))}
      </ul>
    </div>
  );
}
