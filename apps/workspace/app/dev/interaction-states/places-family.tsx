'use client'

import type { JSX } from 'react'
import { Brain, Building2, FolderOpen, LayoutDashboard, ListTodo, Mail, ShieldCheck, Trash2, Users } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/shell/section-nav'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Family, Forced, type StateRowSpec } from './state-table'

const FILES: readonly SectionNavItem[] = [
  { key: 'files', href: '/p/files', icon: FolderOpen, label: 'Ordner' },
  { key: 'mail', href: '/p/files/mail', icon: Mail, label: 'E-Mail-Eingang', count: 9, countLabel: '9 warten' },
  { key: 'points', href: '/p/files/points', icon: ListTodo, label: 'Offene Punkte' },
  { key: 'bin', href: '/p/files/bin', icon: Trash2, label: 'Papierkorb' },
]

const SETTINGS: readonly SectionNavItem[] = [
  { key: 'overview', href: '/p/settings', icon: LayoutDashboard, label: 'Übersicht' },
  { key: 'members', href: '/p/settings/members', icon: Users, label: 'Mitglieder' },
  { key: 'memory', href: '/p/settings/memory', icon: Brain, label: 'Gedächtnis' },
]

const ORGANIZATION: readonly SectionNavItem[] = [
  { key: 'office', href: '/o', icon: Building2, label: 'Büro' },
  { key: 'people', href: '/o/people', icon: Users, label: 'Mitglieder' },
  { key: 'access', href: '/o/access', icon: ShieldCheck, label: 'Rollen und Rechte' },
]

function KitTabs(): JSX.Element {
  return (
    <Tabs defaultValue="documents">
      <TabsList aria-label="Ansichten">
        <TabsTrigger value="documents">Dokumente</TabsTrigger>
        <TabsTrigger value="tasks">Aufgaben</TabsTrigger>
        <TabsTrigger value="history">Verlauf</TabsTrigger>
      </TabsList>
      {/* The open tab names its panel (`aria-controls`), so the panel exists; the strip is what is shown. */}
      <TabsContent value="documents" className="sr-only">
        Sieben Dokumente in diesem Projekt.
      </TabsContent>
    </Tabs>
  )
}

const ROWS: readonly StateRowSpec[] = [
  {
    label: 'Reiter, Dateien',
    note: 'Ordner, E-Mail-Eingang, Offene Punkte, Papierkorb',
    cells: [
      <Forced key="rest">
        <SectionNav label="Dateien" items={FILES} rootHref="/p/files" pathname="/p/files" pillId="states-files-rest" orientation="tabs" track />
      </Forced>,
      <Forced key="hover" state="hover" target='a[href="/p/files/mail"]'>
        <SectionNav label="Dateien" items={FILES} rootHref="/p/files" pathname="/p/files" pillId="states-files-hover" orientation="tabs" track />
      </Forced>,
    ],
  },
  {
    label: 'Reiter, Projekteinstellungen',
    note: 'Übersicht, Mitglieder, Gedächtnis: dieselbe Form',
    cells: [
      <Forced key="rest">
        <SectionNav label="Projekt" items={SETTINGS} rootHref="/p/settings" pathname="/p/settings" pillId="states-settings-rest" orientation="tabs" track />
      </Forced>,
      <Forced key="hover" state="hover" target='a[href="/p/settings/members"]'>
        <SectionNav label="Projekt" items={SETTINGS} rootHref="/p/settings" pathname="/p/settings" pillId="states-settings-hover" orientation="tabs" track />
      </Forced>,
    ],
  },
  {
    label: 'Leiste neben dem Inhalt',
    note: 'Organisation: Büro, Mitglieder, Rollen und Rechte',
    cells: [
      <Forced key="rest" className="items-start">
        <SectionNav label="Organisation" items={ORGANIZATION} rootHref="/o" pathname="/o" pillId="states-org-rest" />
      </Forced>,
      <Forced key="hover" state="hover" target='a[href="/o/people"]' className="items-start">
        <SectionNav label="Organisation" items={ORGANIZATION} rootHref="/o" pathname="/o" pillId="states-org-hover" />
      </Forced>,
    ],
  },
  {
    label: 'Tabs des Kits',
    note: 'Automationen, Agenten verbinden, Modell-Details, Zugriff',
    cells: [
      <Forced key="rest">
        <KitTabs />
      </Forced>,
      <Forced key="hover" state="hover" target='[role="tab"]:nth-of-type(2)'>
        <KitTabs />
      </Forced>,
    ],
  },
]

/** The keys on the second place: on a track the ring is drawn inside the tab, beside the content round the row. */
const KEY_ROWS: readonly StateRowSpec[] = [
  {
    label: 'Reiter auf dem Track',
    cells: [
      <Forced key="focus" state="focus" target='a[href="/p/settings/members"]'>
        <SectionNav label="Projekt" items={SETTINGS} rootHref="/p/settings" pathname="/p/settings" pillId="states-settings-focus" orientation="tabs" track />
      </Forced>,
      <Forced key="kit" state="focus" target='[role="tab"]:nth-of-type(2)'>
        <KitTabs />
      </Forced>,
      <Forced key="rail" state="focus" target='a[href="/o/people"]' className="items-start">
        <SectionNav label="Organisation" items={ORGANIZATION} rootHref="/o" pathname="/o" pillId="states-org-focus" />
      </Forced>,
    ],
  },
]

/** Everything that moves the reader to another place of the same page or tier. */
export function PlacesFamily(): JSX.Element {
  return (
    <>
      <PlacesByPointer />
      <Family
        id="places-keys"
        title="2b · Orte mit der Tastatur"
        rule="Der Ring ist ein mittleres Grau, nie Schwarz. Auf einem Track liegt er im Reiter, weil der Track seitlich rollt und einen Ring außen abschneiden würde."
        columns={['Reiter einer Seite', 'Tabs des Kits', 'Leiste neben dem Inhalt']}
        rows={KEY_ROWS}
        wide
      />
    </>
  )
}

function PlacesByPointer(): JSX.Element {
  return (
    <Family
      id="places"
      title="2 · Orte wechseln"
      rule="Ein Reiter führt an einen anderen Ort derselben Seite. Eine Form: ein grauer Track, der offene Reiter ein weißer Daumen. Unter dem Zeiger wird ein Reiter Tinte und eine Stufe dunkler. Neben einem Formular steht dieselbe Auswahl als Leiste."
      columns={['Ruhe (erster Reiter offen)', 'Zeiger auf dem zweiten Reiter']}
      rows={ROWS}
      wide
    />
  )
}
