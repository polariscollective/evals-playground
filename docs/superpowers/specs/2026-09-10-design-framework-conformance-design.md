# Bringing evals-playground onto the Polaris design framework

Date: 10 September 2026
Status: approved, implementation in two stages

## What this changes

The workspace `CLAUDE.md` carries the Polaris Collective design framework v1.1.
This application has never followed it. It runs on the palette and typefaces of
polariscollective.org: cream `#F4EEE2`, olive `#5F6B3A`, Spectral for headings,
Inter for the body, and a plain four pointed star for a mark. The framework asks
for a different palette, three different typefaces, a different mark, and a
different shape of navigation.

The framework is the target, as written. Where it leaves a value underdetermined
this document fixes it, and says why.

Scope is this repository only. Nothing outside `evals-playground` is touched.

## The size of it

| what | count |
|---|---|
| `.tsx` files under `app/` and `components/` | 49 |
| lines in them | 13,200 |
| colour class occurrences | 917 |
| of those, `zinc` / `teal` / `amber` / `red` | 712 / 58 / 76 / 71 |
| `font-serif` occurrences | 14 |
| drop shadows | 5 |
| routes | 11 |

## Colour

The ten framework tokens are declared as Tailwind theme colours, so that new code
can name them directly:

| token | value | use |
|---|---|---|
| `--color-paper` | `#F1EFE3` | page ground |
| `--color-ink` | `#23281B` | body text |
| `--color-olive-deep` | `#333D22` | navigation, primary buttons, dark surfaces |
| `--color-olive` | `#5C6B3C` | headings, secondary text, rules |
| `--color-chartreuse` | `#B7C94B` | active states, focus, section rules, selected rows |
| `--color-gold` | `#C9A227` | the mark on dark surfaces |
| `--color-ok` | `#5C6B3C` | passes, healthy |
| `--color-warn` | `#C9A227` | pending, partial |
| `--color-fail` | `#A0522D` | failures, errors |
| `--color-neutral` | `#8A8F7A` | not run, not applicable |

The 917 existing occurrences are not rewritten one by one in stage one. The four
Tailwind scales they name are repointed at the framework palette instead, the
same technique the file already uses. A class keeps its meaning and changes its
value.

- `zinc` becomes a ramp from paper to ink, olive tinted throughout: `50` is paper,
  `800` is olive deep, `900` is ink. `500`, which carries most of the secondary
  text in the application, becomes olive rather than a grey, because a grey light
  enough to read as secondary does not pass AA on paper.
- `teal` becomes olive at `600` and `700`, olive deep at `800` and `900`,
  chartreuse tints below `300`. Chartreuse never lands on a step that carries
  text.
- `amber` becomes a gold ramp.
- `red` becomes a rust ramp around `--fail`.

Two derived values are needed and are recorded here because the framework does
not state them. Gold at `#C9A227` reaches 2.1:1 on paper and cannot carry text,
so warning text uses `#8A6528` at 4.58:1. Neutral at `#8A8F7A` reaches 2.89:1 and
is therefore a colour for glyphs and rules only; text that means "not run" is
written in olive. Both follow the framework's own rule that text always passes
WCAG AA.

Measured against paper: ink 13.1:1, olive deep 9.9:1, olive 5.0:1, fail 4.9:1.
On the olive deep navigation: paper 9.9:1, muted paper 5.9:1.

## Typography

- Display and headings: Bricolage Grotesque 600, sentence case.
- Body and interface: Instrument Sans, 14px on a 1.5 line height, this being a
  dense tool rather than a prose page.
- Data: IBM Plex Mono 13px for run identifiers, timestamps, scores, model names,
  diffs and table numerics.

Spectral goes. The framework forbids serif faces, so the 14 `font-serif`
occurrences become the display face, and the all caps, letter spaced and
italicised runs go with them.

## The mark

The broken orbit, drawn once in `components/PolarisMark.tsx` and used everywhere
a mark appears. Geometry on a 48 unit grid:

- Ring: centre (24, 26), radius 16, stroke 2.5, an arc of 300 degrees with the
  gap centred on top and spanning 60 degrees.
- Star: centre (22.5, 26.5), which sits up and to the left of the ring centre.
  Rays are straight sided triangles meeting at a waist of radius 2.4, giving
  concave junctions. North 19 units, south 9, east and west 6.5.
- The north ray therefore ends at y = 7.5, outside the ring and inside the gap,
  touching nothing.

Olive deep on paper surfaces, gold on olive deep surfaces. It appears in the
navigation, on the sign in page and as the icon, and nowhere else. It is never a
bullet and never a section marker.

`components/PolarisStar.tsx` is deleted.

## The tab icon

`app/icon.svg` becomes the mark knocked out in paper from an olive deep rounded
square, the ring thickened to 3.5 so that it survives sixteen pixels. The cream
disc goes. `app/favicon.ico` is regenerated from the same drawing if an encoder
is available locally, and removed otherwise, since Next serves the SVG icon to
every browser that matters and two icons that disagree is worse than one.

## Navigation

The sticky horizontal bar becomes a fixed vertical navigation on the left, olive
deep ground, paper text, the open tab marked by a chartreuse bar rather than
chartreuse text. Below the medium breakpoint it lays itself out as a horizontal
olive deep band, because a fixed 224px column on a phone leaves nothing for the
content.

It stays absent from `/shared` and `/signin`, for the reason already recorded in
`AppNav.tsx`: a stranger reading a published run must not be shown a menu of
pages that demand a session.

## Components

- Buttons are pills. Primary: olive deep ground, paper text, chartreuse ground
  and ink text on hover. Secondary: 1px olive border, ink text, no fill.
- Links are ink with a 2px chartreuse underline, and a chartreuse highlight
  behind the text on hover.
- Section headings carry a 56px wide, 3px chartreuse rule above them.
- Inputs take a 1px olive border, 4px radius, paper ground, and a 2px chartreuse
  focus ring. So does every other focusable thing.
- Tables: header row in olive with a 1px rule under it, row separators at 20%
  opacity, numerics right aligned in mono, selected rows chartreuse at 15%, no
  zebra striping.
- Bullets are 6px chartreuse circles.
- The five drop shadows go, and no card returns in their place. Structure is
  drawn with 1px olive rules and whitespace. One bordered callout per view is
  the only permitted box.

## Motion

Interaction feedback is a 150ms colour change and nothing else. No entrances, no
hover lifts. Focus outlines are always visible.

## Two stages

Stage one, the shell: tokens, typefaces, mark, tab icon, navigation, buttons,
links, focus rings, and the removal of shadows and serif. Reviewed before
stage two starts.

Stage two, the interior: the dense pages migrate from the repointed legacy scales
to the semantic tokens, tables take the framework's rules, status colour lands on
`ok`, `warn`, `fail` and `neutral` with a text label beside it in every case. The
legacy scales are retired at the end of it.

## Not in scope

The wording of the interface is not rewritten for the framework's voice section,
beyond what the restyling touches. The Python engine, the API routes and the
Supabase schema are not touched: this is a change of surface only.
