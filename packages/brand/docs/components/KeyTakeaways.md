# KeyTakeaways

„Das Wichtigste in Kürze“ / „Key takeaways“: drei bis fünf Sätze, die man aus dem Beitrag mitnimmt, am Anfang des Beitrags. Komponente `apps/website/src/components/blocks/KeyTakeaways.astro`, Vertrag `KeyTakeawaysBlock` in `contracts.ts`, Styles `ui-takeaways` in `css/blocks.css`.

**Props:** `items` (3–5 Sätze), `title` (ersetzt die Standardüberschrift), `level` (2 oder 3, Standard 2), `locale`.

- Oben eine 2px-Linie in `--ink` über die Textbreite, wie das Schriftfeld einer Zeichnung; keine Fläche, kein Rahmen. Überschrift `heading-3`, Punkte `body` mit 6px-Quadrat in `--ink` als Aufzählungszeichen.
- Ein `<aside>` mit eigener Überschrift (`h2`), damit Screenreader ihn in der Überschriftenliste finden.
- Ganze Sätze mit Punkt, je höchstens 200 Zeichen. Jeder Satz sagt etwas, das im Beitrag belegt ist; keine Teaser, keine Fragen.
- Einmal je Beitrag, ganz oben unter dem Titelbild.
