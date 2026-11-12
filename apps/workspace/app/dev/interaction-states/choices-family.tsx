'use client'

import type { JSX } from 'react'
import { Bold, Check, LayoutGrid, List } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Family, Forced, type ForcedState, type StateRowSpec } from './state-table'

const COLUMNS = ['Ruhe', 'Zeiger auf nicht Gewähltem', 'Zeiger auf Gewähltem', 'Tastatur'] as const

const UNCHOSEN = '[data-state="off"]:first-of-type, [data-state="unchecked"]:first-of-type'
const CHOSEN = '[data-state="on"], [data-state="checked"]'

/** One choice in the four states a choice has: at rest, the pointer on what is not chosen, on what is, and the keys. */
function states(draw: () => JSX.Element): readonly JSX.Element[] {
  const cell = (key: string, state?: ForcedState, target?: string): JSX.Element => (
    <Forced key={key} state={state} target={target}>
      {draw()}
    </Forced>
  )
  return [cell('rest'), cell('hover-off', 'hover', UNCHOSEN), cell('hover-on', 'hover', CHOSEN), cell('focus', 'focus', UNCHOSEN)]
}

const MailFilter = (): JSX.Element => (
  <ToggleGroup type="single" segmented size="sm" defaultValue="waiting" aria-label="Status" className="[&>button]:text-sm">
    <ToggleGroupItem value="done">Bearbeitet</ToggleGroupItem>
    <ToggleGroupItem value="waiting">Wartet</ToggleGroupItem>
  </ToggleGroup>
)

const ViewToggle = (): JSX.Element => (
  <ToggleGroup type="single" segmented size="icon-sm" defaultValue="cards" aria-label="Ansicht">
    <ToggleGroupItem value="list" aria-label="Liste">
      <List />
    </ToggleGroupItem>
    <ToggleGroupItem value="cards" aria-label="Kacheln">
      <LayoutGrid />
    </ToggleGroupItem>
  </ToggleGroup>
)

const FilterChips = (): JSX.Element => (
  <ToggleGroup type="multiple" variant="chip" size="sm" defaultValue={['me']} className="gap-2 [&>button]:text-name" aria-label="Filter">
    {[
      ['due', 'Überfällig'],
      ['me', 'Für Sie'],
    ].map(([value, label]) => (
      <ToggleGroupItem key={value} value={value}>
        <Check className="hidden size-3.5 in-data-[state=on]:block" aria-hidden />
        {label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)

const Toggles = (): JSX.Element => (
  <div className="flex gap-2">
    <Toggle aria-label="Kursiv" size="sm">
      <Bold aria-hidden />
    </Toggle>
    <Toggle aria-label="Fett" size="sm" defaultPressed>
      <Bold aria-hidden />
    </Toggle>
  </div>
)

const Checks = (): JSX.Element => (
  <div className="flex gap-4">
    <label className="flex items-center gap-2 text-sm">
      <Checkbox /> Offen
    </label>
    <label className="flex items-center gap-2 text-sm">
      <Checkbox defaultChecked /> Geprüft
    </label>
  </div>
)

const Radios = (): JSX.Element => (
  <RadioGroup defaultValue="weekly" className="flex gap-4" aria-label="Rhythmus">
    <label className="flex items-center gap-2 text-sm">
      <RadioGroupItem value="once" /> Einmal
    </label>
    <label className="flex items-center gap-2 text-sm">
      <RadioGroupItem value="weekly" /> Wöchentlich
    </label>
  </RadioGroup>
)

const Switches = (): JSX.Element => (
  <div className="flex gap-4">
    <Switch aria-label="Aus" />
    <Switch aria-label="An" defaultChecked />
  </div>
)

const Dropdown = (): JSX.Element => (
  <Select defaultValue="draft">
    <SelectTrigger className="w-40" aria-label="Status">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="draft">Entwurf</SelectItem>
      <SelectItem value="filed">Eingereicht</SelectItem>
    </SelectContent>
  </Select>
)

const ROWS: readonly StateRowSpec[] = [
  { label: 'Auswahlregler, Text', note: 'Eine von wenigen Ansichten: Wartet / Bearbeitet, Liste / Zeitplan', cells: states(MailFilter) },
  { label: 'Auswahlregler, Glyphen', note: 'Kacheln oder Liste', cells: states(ViewToggle) },
  { label: 'Filter-Chips', note: 'Mehrere zugleich: Offene Punkte, Suche', cells: states(FilterChips) },
  { label: 'Umschalter', note: 'Ein Werkzeug an oder aus (Editor, Viewer)', cells: states(Toggles) },
  { label: 'Kästchen', note: 'Mehrfachauswahl in Listen und Formularen', cells: states(Checks) },
  { label: 'Optionsfeld', note: 'Eines von mehreren im Formular', cells: states(Radios) },
  { label: 'Schalter', note: 'Eine Einstellung an oder aus', cells: states(Switches) },
  {
    label: 'Auswahlfeld',
    note: 'Eines von vielen: öffnet ein Menü',
    cells: [
      <Forced key="rest">
        <Dropdown />
      </Forced>,
      <Forced key="hover" state="hover">
        <Dropdown />
      </Forced>,
      null,
      <Forced key="focus" state="focus">
        <Dropdown />
      </Forced>,
    ],
  },
]

/** Everything that picks among options without leaving the place. */
export function ChoicesFamily(): JSX.Element {
  return (
    <Family
      id="choices"
      title="3 · Auswählen"
      rule="Eine Auswahl ändert, was der Ort zeigt. Auf dem Track nimmt das nicht Gewählte unter dem Zeiger eine Stufe, das Gewählte bleibt der weiße Daumen. Ein leeres Kästchen oder Optionsfeld füllt sich, ein Feld zeigt es an seinem Rand."
      columns={COLUMNS}
      rows={ROWS}
    />
  )
}
