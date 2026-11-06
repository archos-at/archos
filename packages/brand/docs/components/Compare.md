# Compare

Vorher/nachher: zwei Stände derselben Zeichnung übereinander, mit einer Trennlinie, die die Leserin verschiebt. Komponente `apps/website/src/components/blocks/Compare.astro`, Vertrag `CompareBlock` in `contracts.ts`, Styles `ui-compare` in `css/blocks.css`.

**Props:** `before`, `after` (Bilder mit `src`, `width`, `height`, `alt`, optional `srcset`, `sizes`; gleiches Seitenverhältnis), `beforeLabel`, `afterLabel` (Namen der Stände: „Rev. C, 12.09.“), `caption`, `start` (Startposition in Prozent, Standard 50), `locale`.

- Ohne Script stehen beide Stände untereinander, jeder mit seinem Namen darüber. Nichts fehlt.
- Mit Script liegen sie übereinander: links der frühere, rechts der spätere Stand, getrennt durch eine 2px-Linie in `--ink` mit einem 32px-Griff (`--ink`, `radius-md`, Pfeile in `--on-ink`). Die Namen stehen oben links und rechts auf `--surface`, jeder auf seinem Bild.
- Bedienung über ein natives `<input type="range">` über der ganzen Zeichnung: Pfeiltasten, Pos1/Ende, Bild auf/ab, Screenreader (Rolle Schieberegler, `aria-valuetext` „Links Rev. C, rechts Rev. D, Trennlinie bei 50 Prozent“). Ein Klick oder Tipp setzt die Linie dorthin, Ziehen mit Maus oder Finger nimmt sie mit; senkrecht scrollt die Seite weiter (`touch-action: pan-y`). Fokus zeigt `--focus-ring` am Griff.
- Keine Animation: Die Linie folgt der Hand oder der Taste sofort. Eine Taste, die hundertmal gedrückt wird, bekommt keinen Übergang; dasselbe gilt für reduzierte Bewegung, ohne Sonderfall.
- Ab 1280px bricht der Block aus der Textspalte aus (bis 1040px), wie die Abbildungen eines Beitrags.
- Für Zeichnungen und Screenshots desselben Ausschnitts. Zwei verschiedene Bilder nebeneinander sind kein Vergleich.
