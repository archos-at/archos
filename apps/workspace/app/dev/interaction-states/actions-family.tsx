'use client'

import type { JSX, ReactNode } from 'react'
import { Download, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Family, Forced, type StateRowSpec } from './state-table'

const COLUMNS = ['Ruhe', 'Zeiger', 'Gedrückt', 'Tastatur', 'Deaktiviert'] as const

/** One button in every state it has: the same props five times, the state forced on four of them. */
function states(props: ButtonProps, children: ReactNode): readonly ReactNode[] {
  return [
    <Forced key="rest">
      <Button {...props}>{children}</Button>
    </Forced>,
    <Forced key="hover" state="hover">
      <Button {...props}>{children}</Button>
    </Forced>,
    <Forced key="active" state="active">
      <Button {...props}>{children}</Button>
    </Forced>,
    <Forced key="focus" state="focus">
      <Button {...props}>{children}</Button>
    </Forced>,
    <Forced key="disabled">
      <Button {...props} disabled>
        {children}
      </Button>
    </Forced>,
  ]
}

const ROWS: readonly StateRowSpec[] = [
  {
    label: 'Primär',
    note: 'Die eine Hauptaktion eines Bereichs („Hochladen“)',
    cells: states({ size: 'sm' }, <><Plus aria-hidden />Hochladen</>),
  },
  {
    label: 'Sekundär',
    note: 'Weiß mit Kante: jede weitere Aktion („Ordner anlegen“, „Exportieren“)',
    cells: states({ size: 'sm', variant: 'secondary' }, 'Ordner anlegen'),
  },
  {
    label: 'Ghost',
    note: 'Ohne Rahmen: die leiseste Aktion, in Leisten und Zeilen',
    cells: states({ size: 'sm', variant: 'ghost' }, <><Download aria-hidden />Herunterladen</>),
  },
  {
    label: 'Ghost, nur Glyphe',
    note: 'Werkzeug in einer Zeile oder Leiste (⋯, ×)',
    cells: states({ size: 'icon', variant: 'ghost', 'aria-label': 'Weitere Aktionen' }, <MoreHorizontal aria-hidden />),
  },
  {
    label: 'Löschen',
    note: 'Unumkehrbar, nur im Bestätigungsdialog',
    cells: states({ size: 'sm', variant: 'destructive' }, <><Trash2 aria-hidden />Endgültig löschen</>),
  },
  {
    label: 'Link',
    note: 'Führt woanders hin; unterstrichen erst unter dem Zeiger',
    cells: states({ size: 'sm', variant: 'link' }, 'Alle anzeigen'),
  },
  {
    label: 'Link im Satz',
    note: 'Aktion in laufendem Text; immer unterstrichen',
    cells: states({ variant: 'inline' }, 'In der Prüfansicht öffnen'),
  },
]

/** Everything that does something when pressed. */
export function ActionsFamily(): JSX.Element {
  return (
    <Family
      id="actions"
      title="1 · Aktionen"
      rule="Ein Button tut etwas. Drei Lautstärken: Primär (Tinte), Sekundär (weiß mit Kante), Ghost (nur Wort oder Glyphe). Unter dem Zeiger geht jede eine Stufe: Tinte wird heller, Weiß füllt sich, Ghost nimmt den Hover-Ton."
      columns={COLUMNS}
      rows={ROWS}
    />
  )
}
