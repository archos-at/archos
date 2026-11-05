# AnnotatedImage

Ein Bild (Zeichnung, Screenshot) mit nummerierten Markierungen und derselben Nummerierung als Liste darunter. Komponente `apps/website/src/components/blocks/AnnotatedImage.astro`, Vertrag `AnnotatedImageBlock` in `contracts.ts`, Styles `ui-annotated` in `css/blocks.css`.

**Props:** `image` (`src`, `width`, `height`, `alt`, optional `srcset`, `sizes`), `markers` (1–9, je `x`, `y` in Prozent von links oben, `title`, `text`), `caption`, `locale`.

- Markierungen wie die Nummern im Produkt-Screenshot und wie die Achskreise einer Zeichnung: 28px Kreis in `--ink`, Ziffer in `--on-ink` (`small`), 2px `--surface`-Ring, damit sie auf dunklen Linien lesbar bleiben. Der Kreis ist hier eine Zeichnungskonvention, kein Bedienelement-Radius.
- Die Liste darunter trägt alle Erklärungen: Nummer, Titel (`body`, `ink`), Text (`body`, `ink-muted`), Trennlinien in `--line`, höchstens Textbreite (`--measure`). Nichts steht nur im Hover.
- Markierung und Eintrag gehören zusammen: Klick, Tastaturfokus und (nur mit feinem Zeiger) Hover heben beide hervor; der Kreis kehrt sich um (`--surface`-Fläche, `--ink`-Rand und -Ziffer), der Eintrag bekommt `--surface-sunken`. 200ms `ease-out`, nur Farbe. Ein Klick scrollt den Partner nur dann ins Bild, wenn er nicht sichtbar ist, mit reduzierter Bewegung ohne Gleiten.
- Ohne Script ist jede Markierung ein Link zu ihrem Eintrag und jede Nummer in der Liste ein Link zurück; `:target` hebt hervor.
- Barrierefreiheit: Jede Markierung heißt „Markierung 1: Titel“, die sichtbare Ziffer steht am Anfang des Namens (WCAG 2.5.3). Ziel 28px (WCAG 2.5.8).
- Markierungen auf das, worüber der Text spricht, nicht auf Beschriftungen im Bild. Höchstens neun; mehr ist ein zweites Bild.
