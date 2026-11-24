'use client'

import type { JSX, ReactNode } from 'react'
import { Download, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { FloatingToolbar, ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { Family, Forced, type StateRowSpec } from './state-table'

const COLUMNS = ['Ruhe', 'Zeiger', 'Gedrückt', 'Tastatur', 'Deaktiviert'] as const

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

function stripWord(state: 'hover' | 'active' | 'focus' | 'open' | 'disabled' | undefined): ReactNode {
  return (
    <Forced key={state ?? 'rest'} state={state === 'open' || state === 'disabled' ? undefined : state} target="button">
      <FloatingToolbar>
        <ToolbarTextButton data-state={state === 'open' ? 'open' : 'closed'} aria-haspopup="dialog" disabled={state === 'disabled'}>
          {state === 'disabled' ? 'Maßstab' : 'Maßstab 1:100'}
        </ToolbarTextButton>
      </FloatingToolbar>
    </Forced>
  )
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
    label: 'Wort in der Leiste',
    note: 'Sagt einen Zustand und öffnet sein Popover („Maßstab 1:100“ im Messmodus); Gedrückt: das Popover ist offen',
    cells: [stripWord(undefined), stripWord('hover'), stripWord('open'), stripWord('focus'), stripWord('disabled')],
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
