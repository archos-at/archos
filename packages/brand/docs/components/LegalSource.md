# LegalSource

Karte für eine Rechtsquelle, auf die sich ein Beitrag stützt: Norm oder Gesetz, Fundstelle, Fassung, kurzer Wortlaut, Link zur Quelle. Komponente `apps/website/src/components/blocks/LegalSource.astro`, Vertrag `LegalSourceBlock` in `contracts.ts`, Styles `ui-legal` in `css/blocks.css`.

**Props:** `title` („OIB-Richtlinie 2.2“), `section` („Punkt 5.1.1“, „§ 106 Abs. 2“), `version` („Ausgabe Mai 2023“), `issuer`, `excerpt`, `excerptLang`, `url` (nur https), `locale`.

- Eine Zelle auf `--surface-sunken`, eckig, 32/40px Innenabstand (unter 768px 24/16). Oben die Art („Baurecht“, das Wort der Quellenart `building_law` im Produkt) und der Herausgeber in `small`, `ink-muted`; der Titel in `heading-3`; Fundstelle und Fassung in `small`, `ink`.
- Der Wortlaut als `<blockquote cite>` mit 2px-Linie in `--line-strong` links, `body` in `ink`: wörtlich, kurz, nie umformuliert. Ein deutscher Wortlaut in einem englischen Beitrag bleibt deutsch und bekommt `excerptLang: "de"` (`lang="de"`).
- Link „Zur Quelle“ als Textlink, daneben der Host (`ris.bka.gv.at`) in `ink-muted`, damit klar ist, wohin er führt. Der Linkname nennt für Screenreader auch Titel und Fundstelle.
- Dieselben Angaben wie die Quellenangaben im Produkt (Dokument, Fundstelle, Fassung), aber in der Typografie der Website: keine Tönung, kein Chip.
- Nur geprüfte Fundstellen. Was nicht verifiziert ist, steht nicht in dieser Karte.
