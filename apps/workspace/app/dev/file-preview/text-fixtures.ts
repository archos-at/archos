import type { FileItem } from '@/features/documents/components/project-file-workspace'

export const TEXT_FIXTURES: Record<'markdown' | 'csv' | 'text', FileItem> = {
  markdown: {
    id: 'dev-doc-md',
    filename: 'Bueroablauf_Einreichplanung.md',
    displayName: null,
    fileSize: 2_140,
    contentType: 'text/markdown',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: 'Interne Checkliste für die Einreichplanung, Stand Juni 2026.',
    pageCount: null,
    chunkCount: 4,
    contentTypes: ['text'],
    tags: ['Checkliste'],
    topics: null,
    capture: null,
  },
  csv: {
    id: 'dev-doc-csv',
    filename: 'U-Werte_Bauteilkatalog.csv',
    displayName: null,
    fileSize: 860,
    contentType: 'text/csv',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: 'Bauteilkatalog mit U-Werten und den zugehörigen OIB-Anforderungen.',
    pageCount: null,
    chunkCount: 2,
    contentTypes: ['text', 'table'],
    tags: [],
    topics: null,
    capture: null,
  },
  text: {
    id: 'dev-doc-txt',
    filename: 'Protokoll_Bauverhandlung.txt',
    displayName: null,
    fileSize: 1_180,
    contentType: 'text/plain',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: 1,
    contentTypes: ['text'],
    tags: [],
    topics: null,
    capture: null,
  },
}

export const MARKDOWN_BODY = `# Einreichplanung — Bürocheckliste

Gilt für alle Einreichungen in Oberösterreich ab **Juni 2026**.

## Vor der Abgabe

- [x] Lageplan mit Höhenkoten, Maßstab 1:500
- [x] Grundrisse aller Geschosse, 1:100
- [ ] Energieausweis nach OIB-RL 6
- [ ] Nachweis der zwei Fluchtwege je Nutzungseinheit (OIB-RL 2)

## Häufige Rückfragen der Behörde

| Thema | Fundstelle | Anmerkung |
| --- | --- | --- |
| Fluchtweglänge | OIB-RL 2, Pkt. 5.1.1 | max. 40 m im notwendigen Flur |
| Anleiterbarkeit | OIB-RL 2, Pkt. 5.2 | Ostfassade, Aufstellfläche prüfen |

> Bei Gebäudeklasse 4 ist das Sicherheitstreppenhaus früh mit der Feuerwehr
> abzustimmen — Nachbesserungen kosten hier regelmäßig zwei Wochen.
`

export const CSV_BODY = `Bauteil;U-Wert [W/m²K];Anforderung OIB-6;Bewertung
Außenwand gegen Außenluft;0,20;0,35;erfüllt
Oberste Geschossdecke;0,15;0,20;erfüllt
Fenster (Uw);1,10;1,40;erfüllt
Kellerdecke;0,38;0,40;"knapp erfüllt, Nachweis beilegen"
Eingangstür;1,60;1,70;erfüllt
`

export const TEXT_BODY = `Protokoll der Bauverhandlung
Wohnbau Nord, Linz — 14.06.2026, 09:00 Uhr

Anwesend:
  Bauwerberin      Wohnbau Nord GmbH, vertreten durch DI Huber
  Sachverständiger Amt der Oö. Landesregierung, DI Mayrhofer
  Nachbarn         Grundstück 412/3 und 412/7

Verhandlungsgegenstand
  Neubau eines Wohngebaeudes der Gebaeudeklasse 4 mit vier Wohneinheiten
  je Regelgeschoss, Errichtung in Brettsperrholz-Bauweise.

Ergebnis
  Keine Einwendungen der Nachbarn zur Bebauungshoehe. Der Sachverständige
  fordert die Vorlage des Rauchableitungsnachweises fuer das Treppenhaus
  binnen vier Wochen nach.
`
