# FeatureTiles

Zwei bis sechs gleichwertige Punkte im Raster, nur über Weißraum gegliedert – ohne Trennlinien, Karten oder Icons.

**Props:** `items` – `[{ title, text, href? }]`; `columns` (Standard: Anzahl, höchstens 4); `variant` – `plain` (Standard) oder `cells`.

- Optional `href` (Website): Der Titel wird zum Textlink mit „→“ (`ui-link`, kein Icon, kein neues Token) und führt zur Seite, die den Punkt erklärt – etwa von „Baurecht durchsuchen“ zur Baurecht-Seite.

- Titel `heading-3`, Text `body` in `ink-muted`, Abstand `space-3`. Keine Labels, Nummern oder Icons.
- Startseite: drei Punkte unter dem Teamfoto 3:1 („Gebaut für Architektur- & Planungsbüros.“), Text höchstens 356px breit.
- Datensicherheit: sechs Punkte in drei Spalten, Text höchstens 380px. Titel als kurze Aussage („Kein Training mit Ihren Daten“, „Hosting in Wien“).
- Variante `cells` (`ui-features-cells`, Website, bewusst über die Übergabe hinaus, 2026-11-05): nur auf einem grauen Band (`ui-band`). Jeder Punkt ist eine eckige Zelle auf `surface` mit `space-8` Innenabstand (Smartphone `space-6`), `space-2` Abstand dazwischen; keine Linie, kein Schatten. Drei Spalten ab 1024px, zwei bis 768px, darunter eine. Einsatz: Datensicherheit, „So schützen wir Ihre Daten.“, damit sich die Schutzpunkte klar vom Rest der Seite abheben.
