'use client'

import type { JSX } from 'react'
import { Bug, ChevronRight, FileText, Folder, Lightbulb } from 'lucide-react'
import { BreadcrumbLink } from '@/components/ui/breadcrumb'
import { Chip, type ChipProps } from '@/components/ui/chip'
import { ChoiceCard, ChoiceCardGroup } from '@/components/ui/choice-card'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemDescription, ItemList, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Listbox, ListboxOption } from '@/components/ui/listbox'
import { RaisedCard, RaisedCardBody } from '@/components/ui/raised-card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { FolderCardFrame } from '@/features/documents/components/folder-card-frame'
import { FileTileBody, FileTileMedia, TileShell } from '@/features/documents/components/file-tile'
import { Family, Forced, type ForcedState, type StateRowSpec } from './state-table'

/** A list row that opens something: the kit's `Item` as a button, in a list of one. */
function ListRow({ state, mark }: { state?: ForcedState; mark?: 'current' | 'picked' }): JSX.Element {
  return (
    <Forced state={state} target="button" className="w-full">
      <ItemList className="bg-card w-full">
        <Item asChild className={mark === 'picked' ? 'w-full bg-selected hover:bg-selected' : 'w-full'} data-current={mark === 'current' ? '' : undefined}>
          <button type="button">
            <ItemMedia>
              <FileText className="text-muted-foreground size-4" aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Statik S-101</ItemTitle>
              <ItemDescription>vor 1 Stunde</ItemDescription>
            </ItemContent>
          </button>
        </Item>
      </ItemList>
    </Forced>
  )
}

function DataRow({ state, picked = false }: { state?: ForcedState; picked?: boolean }): JSX.Element {
  return (
    <Forced state={state} target="tr" className="w-full">
      <Table>
        <TableBody>
          <TableRow data-state={picked ? 'selected' : undefined}>
            <TableCell>Lageplan.pdf</TableCell>
            <TableCell className="text-muted-foreground text-right whitespace-nowrap tabular-nums">1,9 MB</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Forced>
  )
}

function MenuEntry({ state, active = false }: { state?: ForcedState; active?: boolean }): JSX.Element {
  return (
    <Forced state={state} target='[role="option"]:first-of-type' className="w-full">
      <Listbox aria-label="Ablegen in" className="w-full">
        <ListboxOption active={active}>Umbenennen</ListboxOption>
        <ListboxOption>Verschieben</ListboxOption>
      </Listbox>
    </Forced>
  )
}

function OpeningCard({ state }: { state?: ForcedState }): JSX.Element {
  return (
    <Forced state={state} className="w-full">
      <RaisedCard interactive className="w-full">
        <RaisedCardBody className="grid gap-0.5 p-3">
          <span className="text-name">Hotel Semmering</span>
          <span className="text-muted-foreground text-meta">Neubau Gästetrakt</span>
        </RaisedCardBody>
      </RaisedCard>
    </Forced>
  )
}

function Options({ state, target }: { state?: ForcedState; target?: string }): JSX.Element {
  return (
    <Forced state={state} target={target} className="w-full">
      <ChoiceCardGroup defaultValue="idea" aria-label="Art" className="w-full grid-cols-2 sm:grid-cols-2">
        <ChoiceCard value="bug" icon={Bug} label="Fehler" />
        <ChoiceCard value="idea" icon={Lightbulb} label="Idee" />
      </ChoiceCardGroup>
    </Forced>
  )
}

/** A folder as Dateien draws it: the sheet in its tile, which names the group the sheet answers in. */
function FolderSheet({ state }: { state?: ForcedState }): JSX.Element {
  return (
    <Forced state={state} className="w-full">
      <div className="group w-full">
        <FolderCardFrame editing={false} onOpen={() => undefined} openLabel="Brandschutz 2 Elemente öffnen">
          <span className="flex h-14 min-w-0 flex-1 items-center gap-3 px-3">
            <Folder className="text-muted-foreground size-[18px] shrink-0" strokeWidth={1.6} aria-hidden />
            <span className="grid min-w-0 flex-1">
              <span className="text-name truncate">Brandschutz</span>{' '}
              <span className="text-muted-foreground text-meta">2 Elemente</span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </span>
        </FolderCardFrame>
      </div>
    </Forced>
  )
}

/** A file tile as Dateien draws it: the thumbnail's sheet, the name under it. */
function FileTile({ state, picked = false }: { state?: ForcedState; picked?: boolean }): JSX.Element {
  return (
    <Forced state={state} className="w-full">
      <TileShell className={picked ? 'bg-selected w-full' : 'w-full'}>
        <FileTileMedia className="grid h-20 content-center gap-1.5 px-4">
          <span className="bg-selected h-1.5 w-2/3 rounded-full" />
          <span className="bg-desk h-1.5 rounded-full" />
          <span className="bg-desk h-1.5 w-5/6 rounded-full" />
        </FileTileMedia>
        <FileTileBody className="grid gap-0.5 pt-2">
          <span className="text-name truncate">Energieausweis.pdf</span>
          <span className="text-muted-foreground text-meta truncate">PDF · 900 kB</span>
        </FileTileBody>
      </TileShell>
    </Forced>
  )
}

const ROWS: readonly StateRowSpec[] = [
  {
    label: 'Listenzeile',
    note: 'Projekte, Chats, Postfach, E-Mail-Eingang',
    cells: [<ListRow key="rest" />, <ListRow key="hover" state="hover" />, <ListRow key="active" state="active" />, <ListRow key="focus" state="focus" />, <ListRow key="current" mark="current" />, <ListRow key="picked" mark="picked" />],
  },
  {
    label: 'Tabellenzeile',
    note: 'Dateiliste, Raumbuch, Plattform-Tabellen',
    cells: [<DataRow key="rest" />, <DataRow key="hover" state="hover" />, null, null, null, <DataRow key="picked" picked />],
  },
  {
    label: 'Eintrag in Menü oder Liste',
    note: 'Menüs, Auswahlfelder, Befehlspalette, Erwähnungen',
    cells: [<MenuEntry key="rest" />, <MenuEntry key="hover" state="hover" />, null, <MenuEntry key="keys" active />, null, null],
  },
  {
    label: 'Karte, die sich öffnet',
    note: 'Projektkarten, Dokumentkarten im Chat',
    cells: [<OpeningCard key="rest" />, <OpeningCard key="hover" state="hover" />, null, null, null, null],
  },
  {
    label: 'Ordner',
    note: 'Dateien: ein weißes Blatt, das sich öffnet',
    cells: [<FolderSheet key="rest" />, <FolderSheet key="hover" state="hover" />, null, <FolderSheet key="focus" state="focus" />, null, null],
  },
  {
    label: 'Dateikachel',
    note: 'Vorschau als Blatt, der Name darunter: die Kante antwortet',
    cells: [<FileTile key="rest" />, <FileTile key="hover" state="hover" />, null, null, null, <FileTile key="picked" picked />],
  },
  {
    label: 'Auswahlkarte',
    note: 'Eine Frage, große Antworten (Projektanlage, Feedback)',
    cells: [<Options key="rest" />, <Options key="hover" state="hover" target='[data-state="unchecked"]' />, null, <Options key="focus" state="focus" target='[data-state="unchecked"]' />, null, null],
  },
]

/** Everything that is a thing rather than a command: a row, a card, an entry. */
export function ObjectsFamily(): JSX.Element {
  return (
    <Family
      id="objects"
      title="4 · Zeilen und Karten"
      rule="Eine Zeile oder Karte ist ein Ding, das sich öffnet. Was keine eigene Fläche hat, nimmt den Hover-Ton; ein weißes Blatt füllt sich selbst eine Stufe dunkler. Nichts hebt sich, und hinter ein Blatt wird kein Grau gelegt."
      columns={['Ruhe', 'Zeiger', 'Gedrückt', 'Tastatur', 'Offen', 'Gewählt']}
      rows={ROWS}
      wide
    />
  )
}

function chipStates(props: ChipProps, label: string): readonly JSX.Element[] {
  const chip = (
    <Chip asChild interactive size="md" {...props}>
      <button type="button">{label}</button>
    </Chip>
  )
  return [<Forced key="rest">{chip}</Forced>, <Forced key="hover" state="hover">{chip}</Forced>, <Forced key="focus" state="focus">{chip}</Forced>]
}

const SMALL_ROWS: readonly StateRowSpec[] = [
  { label: 'Chip, grau', note: 'Dokumentart, Filter in der Suche', cells: chipStates({ variant: 'secondary' }, 'Einreichplan') },
  { label: 'Chip, Rahmen', note: 'Schlagworte', cells: chipStates({ variant: 'outline' }, 'Brandschutz') },
  { label: 'Chip, Herkunft', note: 'Baurecht, Büro, Projekt: der Farbton trägt die Bedeutung', cells: chipStates({ variant: 'info' }, 'OIB-RL 2') },
  {
    label: 'Textfeld',
    note: 'Eingabe, Suche',
    cells: [
      <Forced key="rest"><Input aria-label="Projektname" defaultValue="Wohnhaus Lindenweg" className="w-52" /></Forced>,
      <Forced key="hover" state="hover"><Input aria-label="Projektname" defaultValue="Wohnhaus Lindenweg" className="w-52" /></Forced>,
      <Forced key="focus" state="focus"><Input aria-label="Projektname" defaultValue="Wohnhaus Lindenweg" className="w-52" /></Forced>,
    ],
  },
  {
    label: 'Pfad-Link',
    note: 'Brotkrumen, „Zurück“, stille Verweise',
    cells: [
      <Forced key="rest"><BreadcrumbLink href="#" className="text-muted-foreground text-sm">Projekt</BreadcrumbLink></Forced>,
      <Forced key="hover" state="hover"><BreadcrumbLink href="#" className="text-muted-foreground text-sm">Projekt</BreadcrumbLink></Forced>,
      <Forced key="focus" state="focus"><BreadcrumbLink href="#" className="text-muted-foreground text-sm">Projekt</BreadcrumbLink></Forced>,
    ],
  },
]

/** The small things: a chip, a field, a quiet link. */
export function SmallFamily(): JSX.Element {
  return (
    <Family
      id="small"
      title="5 · Chips, Felder, Links"
      rule="Ein grauer Chip geht eine Stufe dunkler, ein Chip mit Farbton behält ihn und zeigt nur seine Kante, ein stiller Link wird Tinte. Ein Feld hat keine Fläche zum Füllen: sein Rand geht eine Stufe Richtung Tinte, mit der Tastatur wird er das Grau des Fokusrings."
      columns={['Ruhe', 'Zeiger', 'Tastatur']}
      rows={SMALL_ROWS}
    />
  )
}
