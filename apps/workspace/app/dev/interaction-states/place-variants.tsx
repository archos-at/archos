'use client'

import type { JSX } from 'react'
import { Brain, FolderOpen, LayoutDashboard, ListTodo, Mail, Trash2, Users, type LucideIcon } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/shell/section-nav'
import { cn } from '@/lib/utils'
import { Forced, Variant, VariantBlock } from './state-table'

const FILES: readonly SectionNavItem[] = [
  { key: 'files', href: '/v/files', icon: FolderOpen, label: 'Ordner' },
  { key: 'mail', href: '/v/files/mail', icon: Mail, label: 'E-Mail-Eingang' },
  { key: 'points', href: '/v/files/points', icon: ListTodo, label: 'Offene Punkte' },
  { key: 'bin', href: '/v/files/bin', icon: Trash2, label: 'Papierkorb' },
]

const SETTINGS: readonly SectionNavItem[] = [
  { key: 'overview', href: '/v/settings', icon: LayoutDashboard, label: 'Übersicht' },
  { key: 'members', href: '/v/settings/members', icon: Users, label: 'Mitglieder' },
  { key: 'memory', href: '/v/settings/memory', icon: Brain, label: 'Gedächtnis' },
]

/** The second place of each strip: by its href in the kit's nav, by its position in the prototype. */
const SECOND = 'a[href$="/mail"], a[href$="/members"], nav > a[href="#"]:nth-of-type(2)'

/** Both places the owner named, one above the other, drawn the same way. */
function Pair({ draw, hover = false }: { draw: (items: readonly SectionNavItem[], id: string) => JSX.Element; hover?: boolean }): JSX.Element {
  const suffix = hover ? 'hover' : 'rest'
  return (
    <Forced state={hover ? 'hover' : undefined} target={SECOND} className="grid w-full items-start gap-4">
      <div className="grid gap-1.5">
        <span className="text-muted-foreground text-meta">Dateien</span>
        {draw(FILES, `files-${suffix}`)}
      </div>
      <div className="grid gap-1.5">
        <span className="text-muted-foreground text-meta">Projekteinstellungen</span>
        {draw(SETTINGS, `settings-${suffix}`)}
      </div>
    </Forced>
  )
}

/** Variant A: the track of the Dateien page, at both places. */
const track = (items: readonly SectionNavItem[], id: string): JSX.Element => (
  <SectionNav label={id} items={items} rootHref={items[0].href} pathname={items[0].href} pillId={`variant-track-${id}`} orientation="tabs" track />
)

/** Variant C: the pill of the project settings, at both places. */
const pill = (items: readonly SectionNavItem[], id: string): JSX.Element => (
  <SectionNav label={id} items={items} rootHref={items[0].href} pathname={items[0].href} pillId={`variant-pill-${id}`} orientation="tabs" />
)

function UnderlineTab({ icon: Icon, label, open }: { icon: LucideIcon; label: string; open: boolean }): JSX.Element {
  return (
    <a
      href="#"
      aria-current={open ? 'page' : undefined}
      className={cn(
        'duration-quick -mb-px inline-flex items-center gap-1.5 border-b-2 pb-2 text-sm transition-colors ease-out',
        open ? 'border-foreground text-foreground font-medium' : 'text-muted-foreground hover:text-foreground border-transparent hover:border-foreground/25'
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </a>
  )
}

/** Variant B: words on a hairline, the open place underlined in ink. A prototype: nothing in the kit draws it yet. */
const underline = (items: readonly SectionNavItem[], id: string): JSX.Element => (
  <nav aria-label={id} className="border-hairline flex gap-6 border-b">
    {items.map((item, index) => (
      <UnderlineTab key={item.key} icon={item.icon} label={item.label} open={index === 0} />
    ))}
  </nav>
)

/** How the reader moves between the places of one page: the owner's own example. */
export function PlaceVariants(): JSX.Element {
  return (
    <VariantBlock
      id="places"
      title="V1 · Orte wechseln: eine Form für beide Seiten"
      question="Dateien und Projekteinstellungen wechseln heute auf zwei Arten zwischen ihren Orten. Welche eine Form gilt künftig überall?"
    >
      <Variant
        letter="A"
        name="Track mit weißem Daumen"
        verdict="Die Form der Dateien-Seite, überall. Gleiche Grammatik wie die Seitenleiste (weiß auf grau heißt: hier bin ich). Sieht aber aus wie ein Auswahlregler: Ort und Ansicht sind dann nur an Größe und Glyphen zu unterscheiden."
        rest={<Pair draw={track} />}
        hover={<Pair draw={track} hover />}
      />
      <Variant
        letter="B"
        name="Wörter mit Unterstrich"
        recommended
        verdict="Orte sind Wörter auf einer Linie, der offene unterstrichen. Der Regler bleibt dann allein für Ansichten und Filter: zwei Bedeutungen, zwei Formen. Kostet eine Linie unter der Kopfzeile."
        rest={<Pair draw={underline} />}
        hover={<Pair draw={underline} hover />}
      />
      <Variant
        letter="C"
        name="Graue Pille"
        verdict="Die Form der Projekteinstellungen, überall. Wurde auf der Dateien-Seite schon verworfen: neben echten Buttons liest sich die gefüllte Pille als weiterer Button."
        rest={<Pair draw={pill} />}
        hover={<Pair draw={pill} hover />}
      />
    </VariantBlock>
  )
}
