# QaExcerpt

Auszug aus einer Unterhaltung im Workspace: eine Frage aus dem Büro und die Antwort, wie sie im Produkt steht, mit ihren Quellen. Komponente `apps/website/src/components/blocks/QaExcerpt.astro`, Vertrag `QaExcerptBlock` in `contracts.ts`, Styles `ui-qa` in `css/blocks.css`.

**Props:** `question`, `answer` (Markdown: Absätze, fett, Listen; rohes HTML wird maskiert), `sources` (0–6, je `kind`, `title`, `detail`), `sourceCount`, `asker`, `caption`, `locale`.

- Schlicht, ohne nachgebaute Oberfläche: kein Fenster, kein Avatar, keine Knöpfe, die man nicht drücken kann.
- Die Frage rechts, höchstens 85 % breit, auf `--surface-sunken`, eckig; darüber „Frage · Projektleiterin, Wohnbau in Wien“ (`small`, `ink-muted`). `asker` ist eine Rolle, nie ein Name.
- Die Antwort in der Textspalte, darüber „Antwort von {name}“. Danach die Quellen als Liste kleiner Felder (`--surface-sunken`, `small`): zuerst die Art in `ink-muted`, dann Dokument und Fundstelle in `ink`.
- Die Arten sind die Quellenarten des Produkts (`SOURCE_KINDS` in `packages/agent/src/agent/common/source_kinds.py`: `building_law`, `office`, `project`, `web`, `measurement`); die Website hält eine Kopie, die `contracts.test.ts` gegen die generierte Liste des Workspace prüft. Beschriftung aus `ui.ts` (`sourceKinds`): Baurecht, Büroablage, Projekt, Web, Modellmessung. Das Produkt tönt die Arten farbig; die Website hat keine Signalfarben und schreibt die Art aus.
- „Abgeleitet aus 7 Quellen“ nur, wenn `sourceCount` gesetzt ist; die Zahl ist mindestens die der gezeigten Quellen.
- Nur echte Antworten, gekürzt höchstens durch Weglassen, nie umformuliert.
