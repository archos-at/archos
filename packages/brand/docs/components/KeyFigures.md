# KeyFigures

Zwei bis vier Kennzahlen in einer Reihe: der Wert groß, die Einheit kleiner, darunter, was er zählt, und die Quelle als nummerierte Fußnote unter der Reihe. Komponente `apps/website/src/components/blocks/KeyFigures.astro`, Vertrag `KeyFiguresBlock` in `contracts.ts`, Styles `ui-figures` in `css/blocks.css`.

**Props:** `items` (2–4, je `value`, `unit`, `label`, `source`), `locale`.

- Wert in `heading-1` (unter 768px 34/38), Einheit in `heading-3`, Beschriftung `body` in `ink-muted`. Über jedem Wert eine Haarlinie in `--line-strong`, wie eine Maßlinie; kein Kasten, keine Fläche.
- Desktop eine Spalte je Wert, unter 768px zwei Spalten.
- `value` ist Text, so wie er gelesen wird („3,5“, „1.284“), und enthält eine Ziffer. Gleiche Quellen teilen sich eine Nummer.
- Jede Zahl hat eine Quelle (Belegpflicht). Ohne Quelle gehört die Zahl nicht in diese Reihe.
- Keine Bewegung: Zahlen zählen nicht hoch (`docs/ux/motion.md`, „Numbers counting up“).
- Fußnotenzeichen sind Links zur Quelle mit Namen „Quelle 1“; die Liste der Quellen ist ein `<ol>` mit Namen „Quelle“.
