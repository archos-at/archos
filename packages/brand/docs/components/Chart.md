# Chart

Säulen- oder Liniendiagramm aus einer kleinen Tabelle, die die Redaktion tippt oder einfügt. Auf dem Server gezeichnet, ohne Script im Browser. Komponente `apps/website/src/components/blocks/Chart.astro`, Geometrie in `chart-model.ts`, Vertrag (`ChartBlock`) in `contracts.ts`, Styles in `css/blocks.css` (`ui-chart`).

**Props:** `form` (`bar` | `line`), `stacking` (`grouped` | `stacked`, nur Säulen mit 2–3 Reihen), `title`, `caption`, `unit`, `axisLabel`, `decimals`, `startAtZero` (nur Linien), `labels`, `series` (1–3, je `name` und `values`), `source`, `sourceUrl`; dazu `locale`. Grenzen und Beispiel: `apps/website/src/components/blocks/README.md`.

## Form

- **Säulen** für Mengen je Kategorie, immer ab null. Gruppiert vergleicht Reihen nebeneinander, gestapelt zeigt Anteile an einer Summe (keine negativen Werte im Stapel).
- **Linie** für Verlauf über eine geordnete Achse (Kalenderwochen, Planstände). Darf mit `startAtZero: false` über null beginnen.
- Kein zweiter Wertebereich, keine Torte, kein 3D. Zwei Größen verschiedener Einheit sind zwei Diagramme.
- Der Titel ist die Aussage als Satz mit Punkt („Mit jedem Planstand ändern sich weniger Räume.“), die Unterzeile sagt, was gemessen wurde. Jede Zahl hat eine Quelle (`source` ist Pflicht, Belegpflicht).

## Aufbau

- `<figure>` mit `<figcaption>` (Titel `heading-3`, Unterzeile `small` in `ink-muted`), Legende ab zwei Reihen, Zeichenfläche, Quelle (`small`, `ink-muted`).
- Zeichenfläche 240px hoch, unter 768px 200px. Die Markierungen sind ein SVG, das auf die Spaltenbreite gedehnt wird (`preserveAspectRatio="none"`); Linien bleiben dabei gleich stark (`vector-effect: non-scaling-stroke`, wie die Stifte der Blog-Cover). Alle Wörter und Zahlen sind HTML über der Fläche und bleiben in der Schriftgröße der Typo-Skala, auch auf dem Telefon.
- Raster: Haarlinien in `--line`, Nulllinie in `--line-strong`. Achsenwerte links in `small`, `ink-muted`, `tabular-nums`; die Einheit steht am obersten Wert, oder `axisLabel` steht über der Fläche.
- Säulen höchstens 36 von 1000 Einheiten breit (etwa 24px in der 680px-Textspalte), eckig wie alles auf der Website; zwischen berührenden Säulen und Stapelteilen 2px Fläche (`--surface`-Kante).
- Werte: an jeder Säule bzw. auf jedem Stapel die Summe, bei gruppierten Säulen keine (Legende, Achse und Tabelle tragen sie). Linien zeigen ihren letzten Wert rechts neben dem Endpunkt; zwei Endwerte, die sich näher als 20px kommen, zeigen nur den der ersten Reihe. Unter 520px Spaltenbreite entfallen Säulenwerte ab sieben Kategorien, und ab neun Beschriftungen bleibt jede k-te stehen, vom letzten aus gezählt (bei Linien immer).
- Linienpunkte bis acht Werte an jedem Punkt, darüber nur am Ende: 8px, mit 2px `--surface`-Ring.

## Farbe

Die Website hat keine Signalfarben, also sind die Reihen Stufen der einen Tinte, nie Farbtöne:

| Reihe | Token | Kontrast auf `surface` | Linie |
|---|---|---|---|
| 1 | `--ink` | 18,9:1 | durchgezogen, 2px |
| 2 | `--ink-muted` | 6,5:1 | gestrichelt 6/4 (Stift „hidden“) |
| 3 | `--line-strong` | 3,4:1 | gepunktet |

Geprüft mit dem Validator der Dataviz-Methode als geordnete Reihe (`validate_palette.js "#0f0e0d,#5e5b57,#8a8784" --ordinal --surface "#fafaf9"`): Helligkeit monoton, Abstand je Stufe ≥ 0,06 OKLCH-L, hellste Stufe 3,42:1, alle bestanden. Jede Stufe erreicht 3:1 (WCAG 1.4.11). Eine Grau-Reihe besteht die Farbton-Prüfungen einer kategorialen Palette nicht, und muss es nicht: Die Identität trägt nie das Grau allein, sondern die Legende (ab zwei Reihen immer), die Strichart bei Linien und die Reihenfolge im Stapel. Darum höchstens drei Reihen; eine vierte wird zu „Sonstige“ oder zu einem zweiten Diagramm. Texte stehen nie in Reihenfarbe.

## Zugänglichkeit

- Die Zeichenfläche ist `aria-hidden`; dieselben Werte stehen in einer Tabelle, die nur Screenreader sehen (Kopfzeile Kategorie und Reihen, `<caption>` = Titel). Leere Werte als „–“.
- Mit der Maus zeigt jede Säule ihren Wert als natives `<title>`. Kein Tooltip-Script: Die Werte stehen ohnehin an der Säule oder in der Tabelle.
- Keine Bewegung. Ein Diagramm wird gezeigt, nicht aufgebaut.

## Warum selbst gezeichnet (Bibliotheksentscheidung, 2026-11-05)

Geprüft wurden drei Wege, das SVG auf dem Server zu erzeugen:

| Weg | Ergebnis |
|---|---|
| Observable Plot 0.6.18 mit linkedom als DOM | Funktioniert (36 ms für ein Säulendiagramm), bringt aber 16 MB `node_modules` (das ganze d3, linkedom) ins Image der Website. Plot zeichnet ein SVG fester Pixelgröße (640 × 400) mit Text im SVG: Auf 358px Breite wird 10px-Text zu 6px. Farben und Schrift kommen als Attribute (`fill`, `font-family`) und ein eigenes `<style>`, nicht über die Klassen und Tokens des Designsystems. |
| Vega-Lite 6.5 → Vega 6.4 → SVG | 3,7 MB + 5,9 MB Pakete, dieselbe feste Pixelgröße und Text im SVG, Farben als Literale in der Spezifikation. Für Säulen und Linien aus höchstens 24 × 3 Werten weit zu schwer. |
| Eigene Marken, d3-array für die Skala | Gewählt. `d3-array` (115 kB, ohne DOM) liefert `nice`, `ticks` und `tickStep`, den Teil, der allgemein und leicht subtil falsch ist. Die Marken (Rechtecke, Pfade, Punkte) sind wenige Zeilen in `chart-model.ts`; Text ist HTML in Tokens, das SVG wird gedehnt und die Stifte skalieren nicht. So bleibt die Beschriftung auf jedem Gerät lesbar, ohne Script und ohne Breitenmessung. |

`chart-model.test.ts` hält Skala, Achsenwerte, Zahlenformat (`de-AT`, `en-GB`), Säulen, Stapel, Lücken in Linien und das Ausdünnen der Beschriftung fest.
