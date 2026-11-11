'use client'

import type { JSX, ReactNode } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { Forced, Variant, VariantBlock } from './state-table'

/** The same drawing at rest and under the pointer. */
function both(draw: () => ReactNode, target?: string): { rest: JSX.Element; hover: JSX.Element } {
  return {
    rest: <Forced className="w-full">{draw()}</Forced>,
    hover: (
      <Forced state="hover" target={target} className="w-full">
        {draw()}
      </Forced>
    ),
  }
}

/** On the paper and on a white sheet: a press is set on both. */
function OnBothPlanes({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      <div className="flex flex-wrap items-center gap-2 p-3">{children}</div>
      <div className="bg-sheet shadow-sm flex flex-wrap items-center gap-2 rounded-surface p-3">{children}</div>
    </div>
  )
}

/** The white press, filling one step under the pointer instead of gaining a 1px shadow. */
const PRESS_FILLS = 'hover:bg-sheet-hover hover:shadow-press'

/** The white press under the pointer, and whether the outline is a second press. */
export function PressVariants(): JSX.Element {
  const today = both(() => (
    <OnBothPlanes>
      <Button size="sm" variant="secondary">Ordner anlegen</Button>
      <Button size="sm" variant="outline">Exportieren</Button>
    </OnBothPlanes>
  ))
  const one = both(() => (
    <OnBothPlanes>
      <Button size="sm" variant="secondary" className={PRESS_FILLS}>Ordner anlegen</Button>
      <Button size="sm" variant="secondary" className={PRESS_FILLS}>Exportieren</Button>
    </OnBothPlanes>
  ))
  return (
    <VariantBlock
      id="press"
      title="V2 · Der weiße Button: eine Form, und er füllt sich"
      question="Sekundär und Outline stehen für dieselbe Rolle, und der Zeiger gibt dem einen einen 1px-Schatten, dem anderen eine Füllung. Links auf Papier, rechts auf einem weißen Blatt."
    >
      <Variant
        letter="A"
        name="Heute: zwei Formen, zwei Antworten"
        verdict="Sekundär hebt sich um einen Schatten, den man auf Weiß kaum sieht; Outline füllt sich. Auf einem Blatt sind beide weiß mit Rand und nur noch an der Randfarbe zu unterscheiden."
        {...today}
      />
      <Variant
        letter="B"
        name="Eine Form, eine Stufe dunkler"
        recommended
        verdict="Outline entfällt (230 Stellen werden Sekundär). Unter dem Zeiger füllt sich der Button wie alles andere: weiß wird grau, die Kante bleibt."
        {...one}
      />
    </VariantBlock>
  )
}

function Sheet({ className }: { className: string }): JSX.Element {
  return (
    <button type="button" className={cn('bg-sheet shadow-sm duration-quick grid w-56 gap-0.5 rounded-surface p-3 text-left ease-out', className)}>
      <span className="text-name">Hotel Semmering</span>
      <span className="text-muted-foreground text-meta">Neubau Gästetrakt · 14 Dokumente</span>
    </button>
  )
}

/** A card that opens: the lift of the project card, or the fill of the folder. */
export function CardVariants(): JSX.Element {
  return (
    <VariantBlock
      id="card"
      title="V3 · Karte, die sich öffnet: heben oder füllen"
      question="Die Projektkarte hebt sich unter dem Zeiger, der Ordner füllt sich seit dem letzten Stand. Welche Antwort gilt für jedes weiße Blatt?"
    >
      <Variant
        letter="A"
        name="Heben (Schatten)"
        verdict="Heute bei Projektkarten. Eine zweite Sprache neben der Füllung, und im dunklen Modus fast unsichtbar: ein Schatten zeigt sich auf Anthrazit nicht."
        {...both(() => <Sheet className="transition-shadow hover:shadow-md" />)}
      />
      <Variant
        letter="B"
        name="Füllen (eine Stufe dunkler)"
        recommended
        verdict="Wie der Ordner und jede Zeile. Eine Antwort für alles, in hell und dunkel gleich deutlich; nichts bewegt sich."
        {...both(() => <Sheet className="transition-colors hover:bg-sheet-hover" />)}
      />
    </VariantBlock>
  )
}

function Tile({ shell, media }: { shell: string; media: string }): JSX.Element {
  return (
    <div className={cn('group duration-quick flex w-44 flex-col gap-2 rounded-surface p-1.5 transition-colors ease-out', shell)}>
      <div className={cn('bg-sheet shadow-sm duration-quick grid h-24 content-center gap-1.5 rounded-surface px-5 ease-out', media)}>
        <span className="bg-selected h-1.5 w-2/3 rounded-full" />
        <span className="bg-desk h-1.5 rounded-full" />
        <span className="bg-desk h-1.5 w-5/6 rounded-full" />
      </div>
      <div className="grid gap-0.5">
        <span className="text-name">Energieausweis.pdf</span>
        <span className="text-muted-foreground text-meta">PDF · 900 kB · vor 5 Monaten</span>
      </div>
    </div>
  )
}

/** A file tile: its name stands outside its sheet, so the sheet cannot answer alone. */
export function TileVariants(): JSX.Element {
  return (
    <VariantBlock
      id="tile"
      title="V4 · Dateikachel: was antwortet, wenn der Name unter der Vorschau steht"
      question="Beim Ordner lag das Grau hinter dem Blatt und ist jetzt weg. Bei der Dateikachel umfasst die Fläche Vorschau und Name; die Vorschau selbst ist ein Bild und kann sich nicht füllen."
    >
      <Variant
        letter="A"
        name="Fläche um Vorschau und Name"
        verdict="Heute. Hält Bild und Name zusammen (so machen es Drive und Dropbox), legt aber wieder Grau hinter ein weißes Blatt."
        {...both(() => <Tile shell="hover:bg-hover" media="" />)}
      />
      <Variant
        letter="B"
        name="Kante der Vorschau wird Tinte"
        recommended
        verdict="Nichts liegt dahinter, das Blatt selbst antwortet mit seiner Kante. Funktioniert auch bei Fotos und im dunklen Modus. Leiser als die Fläche."
        {...both(() => <Tile shell="" media="transition-shadow group-hover:shadow-[0_0_0_1px_var(--field-border),0_1px_2px_rgb(15_14_13_/_0.06)]" />)}
      />
      <Variant
        letter="C"
        name="Vorschau hebt sich"
        verdict="Schatten statt Fläche. Im dunklen Modus kaum zu sehen und die zweite Sprache aus V3."
        {...both(() => <Tile shell="" media="transition-shadow group-hover:shadow-md" />)}
      />
    </VariantBlock>
  )
}

function Segments({ item }: { item?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <ToggleGroup type="single" segmented size="sm" defaultValue="waiting" aria-label="Status" className="[&>button]:text-sm">
        <ToggleGroupItem value="done" className={item}>Bearbeitet</ToggleGroupItem>
        <ToggleGroupItem value="waiting" className={item}>Wartet</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" segmented size="icon-sm" defaultValue="cards" aria-label="Ansicht">
        <ToggleGroupItem value="list" aria-label="Liste" className={item}>
          <List />
        </ToggleGroupItem>
        <ToggleGroupItem value="cards" aria-label="Kacheln" className={item}>
          <LayoutGrid />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

/** The unchosen half of a choice under the pointer. */
export function SegmentVariants(): JSX.Element {
  const unchosen = '[data-state="off"]'
  return (
    <VariantBlock
      id="segment"
      title="V5 · Auswahlregler: das nicht Gewählte unter dem Zeiger"
      question="Auf dem Track färbt der Zeiger heute nur die Schrift. Soll auch hier die eine Stufe gelten?"
    >
      <Variant
        letter="A"
        name="Nur die Schrift wird Tinte"
        verdict="Heute. Die schwächste Antwort der App: bei einer Glyphe fast nicht zu sehen."
        {...both(() => <Segments />, unchosen)}
      />
      <Variant
        letter="B"
        name="Eine Stufe dunkler, wie überall"
        recommended
        verdict="Das Segment unter dem Zeiger nimmt denselben Hover-Ton wie eine Zeile; der weiße Daumen bleibt das Einzige, was gewählt heißt."
        {...both(() => <Segments item="data-[state=off]:hover:bg-hover" />, unchosen)}
      />
    </VariantBlock>
  )
}

function Fields({ field, box }: { field?: string; box?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-5">
      <Input aria-label="Projektname" defaultValue="Wohnhaus Lindenweg" className={cn('w-52', field)} />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox className={box} /> Offen
      </label>
    </div>
  )
}

/** A field and a box under the pointer: today nothing answers. */
export function FieldVariants(): JSX.Element {
  return (
    <VariantBlock
      id="field"
      title="V6 · Feld und Kästchen: antworten sie dem Zeiger?"
      question="Textfeld, Auswahlfeld, Kästchen, Optionsfeld und Schalter sind die einzigen Elemente ohne Hover."
    >
      <Variant letter="A" name="Keine Antwort" verdict="Heute. Der Mauszeiger wechselt im Textfeld zur Einfügemarke, sonst nichts." {...both(() => <Fields />, 'input, button')} />
      <Variant
        letter="B"
        name="Der Rand wird Tinte"
        recommended
        verdict="Ein Feld hat keine Fläche zum Füllen (es ist weiß, damit man hineinschreibt). Sein Rand geht eine Stufe Richtung Tinte: dieselbe Idee, an der Kante."
        {...both(() => <Fields field="hover:border-foreground/60 transition-[color,opacity,border-color]" box="hover:border-foreground" />, 'input, button')}
      />
    </VariantBlock>
  )
}
