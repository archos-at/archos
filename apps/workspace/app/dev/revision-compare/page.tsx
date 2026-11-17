'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { Button } from '@/components/ui/button'
import { useRevisionCompare } from '@/features/documents/components/revision-compare'
import {
  FIXTURE_OVERLAYS,
  fixtureLoader,
} from '@/features/documents/components/revision-compare/fixture-sheets'
import { PRODUCT_NAME } from '@/lib/brand'

type Autoplay = 'mark' | 'mark-two'

interface Story {
  id: string
  label: string
  older: { id: string; filename: string }
  newer: { id: string; filename: string }
  overlays: typeof FIXTURE_OVERLAYS | readonly []
  autoplay?: Autoplay
}

const STORIES: readonly Story[] = [
  {
    id: 'same',
    label: 'Gleiche Seitenzahl',
    older: { id: 'older', filename: 'Grundriss_1OG_B.pdf' },
    newer: { id: 'newer', filename: 'Grundriss_1OG_C.pdf' },
    overlays: [],
  },
  {
    id: 'known',
    label: 'Bekannte Änderungen',
    older: { id: 'older', filename: 'Grundriss_1OG_B.pdf' },
    newer: { id: 'newer', filename: 'Grundriss_1OG_C.pdf' },
    overlays: FIXTURE_OVERLAYS,
  },
  {
    id: 'pages',
    label: 'Unterschiedliche Seitenzahl',
    older: { id: 'older', filename: 'Grundriss_1OG_B-kurz.pdf' },
    newer: { id: 'newer', filename: 'Grundriss_1OG_C-mehr.pdf' },
    overlays: [],
  },
  {
    id: 'office',
    label: 'Nicht vergleichbar',
    older: { id: 'older', filename: 'Kostenaufstellung_B.xlsx' },
    newer: { id: 'newer', filename: 'Kostenaufstellung_C.xlsx' },
    overlays: [],
  },
  {
    id: 'failed',
    label: 'Ladefehler',
    older: { id: 'older', filename: 'fail_B.pdf' },
    newer: { id: 'newer', filename: 'Grundriss_1OG_C.pdf' },
    overlays: [],
  },
  {
    id: 'long',
    label: 'Lange Dateinamen',
    older: { id: 'older', filename: 'Wohnanlage-Schlosspark_Haus-B_Grundriss_1OG_Index_B_2026-09-14.pdf' },
    newer: { id: 'newer', filename: 'Wohnanlage-Schlosspark_Haus-B_Grundriss_1OG_Index_C_2026-10-02.pdf' },
    overlays: FIXTURE_OVERLAYS,
  },
  {
    id: 'error',
    label: PRODUCT_NAME + ' nicht erreichbar',
    older: { id: 'older', filename: 'Grundriss_1OG_B.pdf' },
    newer: { id: 'newer-503', filename: 'Grundriss_1OG_C.pdf' },
    overlays: [],
    autoplay: 'mark',
  },
  {
    id: 'marked-two',
    label: 'Zwei Seiten markiert',
    older: { id: 'older', filename: 'Grundriss_1OG_B.pdf' },
    newer: { id: 'newer', filename: 'Grundriss_1OG_C.pdf' },
    overlays: [],
    autoplay: 'mark-two',
  },
]

const SUMMARIES: Record<number, string[]> = {
  1: [
    'Die Trennwand zwischen Büro 1 und Besprechung ist um etwa 60 cm nach rechts versetzt.',
    'Der Türanschlag im Flur ist gedreht.',
    'Im Norden ist ein drittes Fenster dazugekommen.',
  ],
  2: ['Die Treppe hat eine Steigung mehr, neun statt acht.'],
}

function useStubbedChangeRoute(): void {
  useEffect(() => {
    const real = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.endsWith('/revision-compare')) return real(input, init)
      await new Promise((resolve) => setTimeout(resolve, 900))
      if (url.includes('/newer-503/')) return new Response(null, { status: 503 })
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const page = typeof body === 'object' && body !== null && 'page' in body ? Number(body.page) : 1
      return Response.json({
        regions: FIXTURE_OVERLAYS.filter((region) => region.page === page),
        summary: SUMMARIES[page] ?? [],
      })
    }
    return () => {
      window.fetch = real
    }
  }, [])
}

const COMPARE_OPTIONS = {
  onOpenTextCompare: (older: { filename: string }, newer: { filename: string }) =>
    window.alert(`Textvergleich: ${older.filename} ↔ ${newer.filename}`),
}

async function enabled(selector: string): Promise<HTMLElement | null> {
  for (let tries = 0; tries < 80; tries += 1) {
    const node = document.querySelector<HTMLElement>(selector)
    if (node && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true') return node
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

function useAutoplay(autoplay: Autoplay | undefined, run: number): void {
  useEffect(() => {
    if (!autoplay || run === 0) return
    let stopped = false
    void (async () => {
      const mark = await enabled('[data-testid="compare-mark"]')
      if (stopped || !mark) return
      mark.click()
      if (autoplay !== 'mark-two') return
      await enabled('[data-testid="compare-change"]')
      const next = await enabled('[aria-label="Nächste Seite"]')
      if (stopped || !next) return
      next.click()
      const second = await enabled('[data-testid="compare-mark"]')
      if (!stopped) second?.click()
    })()
    return () => {
      stopped = true
    }
  }, [autoplay, run])
}

function Preview(): JSX.Element {
  useStubbedChangeRoute()
  const { openRevisionCompare, compareElement } = useRevisionCompare(fixtureLoader, COMPARE_OPTIONS)
  const [played, setPlayed] = useState<{ autoplay?: Autoplay; run: number }>({ run: 0 })
  useAutoplay(played.autoplay, played.run)
  return (
    <main className="bg-background mx-auto max-w-3xl space-y-4 p-6" data-testid="revision-compare-preview">
      <h1 className="text-foreground text-base font-medium">Fassungen vergleichen</h1>
      <p className="text-muted-foreground text-sm">
        Tasten im geöffneten Vergleich: ← → blättern, Pos1 und Ende springen, 1 2 3 wechseln die Ansicht, Esc
        schließt. Strg + Mausrad zoomt, Ziehen verschiebt.
      </p>
      <div className="flex flex-wrap gap-2">
        {STORIES.map((story) => (
          <Button
            key={story.id}
            variant="secondary"
            data-testid={`open-${story.id}`}
            onClick={() => {
              openRevisionCompare(story.older, story.newer, story.overlays)
              setPlayed((last) => ({ autoplay: story.autoplay, run: last.run + 1 }))
            }}
          >
            {story.label}
          </Button>
        ))}
      </div>
      {compareElement}
    </main>
  )
}

export default function RevisionCompareDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
