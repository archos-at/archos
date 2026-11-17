'use client'

import { useEffect, useState, type FC } from 'react'
import { useSearchParams } from 'next/navigation'
import { CitationDocumentDialog } from '@/features/chat/components/source-preview/citation-document-dialog'
import { buildCitationModel, resolveCitationTarget } from '@/features/chat/lib/citations'
import type { CitationSource } from '@/features/chat/types'
import { SimilarPassagesDialog } from '@/features/similar-passages/components/similar-passages-dialog'
import { SimilarPassagesPanel } from '@/features/similar-passages/components/similar-passages-panel'
import type { SimilarPassagesLoader } from '@/features/similar-passages/lib/use-similar-passages'
import { SimilarPassagesError } from '@/lib/similar-passages/client'
import type { SimilarPassagesRequest, SimilarPassagesResponse } from '@/lib/similar-passages/types'
import { I18nProvider } from '@/i18n'
import { buildPdf, type PdfLine } from '../_fixtures/sample-pdf'
import { SectionLabel } from '@/components/ui/section-label'

const FILE_NAME = 'oib-richtlinie-4_2023.pdf'
const TITLE = 'OIB-Richtlinie 4'

const CITED_PASSAGE =
  'Treppen in Fluchtwegen müssen eine nutzbare Laufbreite von mindestens 1,20 m aufweisen; bei Wohngebäuden der Gebäudeklasse 1 und 2 genügen 1,00 m.'

const wrap = (text: string, width = 70): PdfLine[] => {
  const lines: PdfLine[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push([line, 11, false])
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push([line, 11, false])
  return lines
}

const documentWith = (heading: string, page: number, passage: string): Uint8Array<ArrayBuffer> =>
  buildPdf(
    Array.from({ length: Math.max(3, page + 1) }, (_, index): PdfLine[] =>
      index + 1 === page
        ? [[heading, 16, true], ['', 11, false], ...wrap(passage), ['', 11, false], ...wrap(FILLER)]
        : [[heading, 16, true], ['', 11, false], ...wrap(FILLER), ['', 11, false], ...wrap(FILLER)]
    )
  )

const FILLER =
  'Die Angaben beziehen sich auf den Stand der Einreichung. Abweichungen in der Ausführung sind mit der Bauleitung abzustimmen und im Bautagebuch festzuhalten.'

const SOURCE_PDF = (): Uint8Array<ArrayBuffer> => documentWith('4. Treppen', 2, CITED_PASSAGE)

const RESPONSE: SimilarPassagesResponse = {
  origin: 'point',
  projectsSearched: 6,
  groups: [
    {
      kind: 'current',
      project: { id: 'p-moedling', name: 'Wohnhausanlage Mödling', status: 'active' },
      documents: [
        {
          documentId: 'doc-brandschutz',
          filename: 'BSK_Stiege2_IndexC.pdf',
          displayName: 'Brandschutzkonzept Stiege 2',
          contentType: 'application/pdf',
          stand: { kind: 'index', text: 'Index C' },
          passages: [
            {
              page: 4,
              snippet:
                'Die Fluchttreppe der Stiege 2 wird mit einer nutzbaren Laufbreite von 1,20 m ausgeführt; das Geländer ragt nicht in die Laufbreite.',
              score: 0.91,
            },
            {
              page: 6,
              snippet: 'Im Erdgeschoss verbreitert sich der Fluchtweg auf 1,50 m bis zum Ausgang ins Freie.',
              score: 0.84,
            },
          ],
        },
        {
          documentId: 'doc-baubeschreibung',
          filename: 'Baubeschreibung.pdf',
          displayName: null,
          contentType: 'application/pdf',
          stand: { kind: 'date', text: '02.09.2026' },
          passages: [
            {
              page: 2,
              snippet: 'Stiegen in Stahlbeton, Laufbreite 1,20 m, Steigungsverhältnis 17/29, beidseitig Handläufe.',
              score: 0.82,
            },
          ],
        },
      ],
    },
    {
      kind: 'office_shelf',
      project: null,
      documents: [
        {
          documentId: 'doc-musterauflagen',
          filename: 'Musterauflagen_Baubehoerde.pdf',
          displayName: 'Musterauflagen der Baubehörde',
          contentType: 'application/pdf',
          stand: null,
          passages: [
            {
              page: 1,
              snippet:
                'Die Laufbreite der Fluchttreppen darf durch Einbauten, Geländer oder Heizkörper nicht unter 1,20 m eingeschränkt werden.',
              score: 0.88,
            },
          ],
        },
      ],
    },
    {
      kind: 'project',
      project: { id: 'p-baden', name: 'Volksschule Baden', status: 'closed' },
      documents: [
        {
          documentId: 'doc-bescheid-baden',
          filename: 'Bescheid_BA-2024-0112.pdf',
          displayName: 'Baubewilligung BA-2024-0112',
          contentType: 'application/pdf',
          stand: { kind: 'date', text: '14.03.2024' },
          passages: [
            {
              page: 1,
              snippet:
                'Auflage 4: Die Fluchttreppe im Zubau ist mit einer Laufbreite von mindestens 1,20 m herzustellen und dauernd freizuhalten.',
              score: 0.86,
            },
          ],
        },
      ],
    },
    {
      kind: 'project',
      project: { id: 'p-wien', name: 'Kindergarten Wien 22', status: 'active' },
      documents: [
        {
          documentId: 'doc-protokoll',
          filename: 'Protokoll_Bauverhandlung_v1.pdf',
          displayName: 'Protokoll Bauverhandlung',
          contentType: 'application/pdf',
          stand: { kind: 'index', text: 'v1' },
          passages: [
            {
              page: 2,
              snippet: 'Der Amtssachverständige verlangt für die Außentreppe eine Laufbreite von 1,20 m statt 1,00 m.',
              score: 0.79,
            },
          ],
        },
      ],
    },
  ],
}

const FIXTURE_DOCUMENTS = RESPONSE.groups.flatMap((group) => group.documents)

const useBlobUrls = (): Map<string, string> | null => {
  const [urls, setUrls] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    const made = new Map<string, string>()
    const blob = (bytes: Uint8Array<ArrayBuffer>) => URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    made.set('source', blob(SOURCE_PDF()))
    for (const document of FIXTURE_DOCUMENTS) {
      const first = document.passages[0]
      made.set(document.documentId, blob(documentWith(document.displayName ?? document.filename, first.page ?? 1, first.snippet)))
    }
    setUrls(made)
    return () => made.forEach((url) => URL.revokeObjectURL(url))
  }, [])
  return urls
}

const answer: SimilarPassagesLoader = async () => RESPONSE

const SOURCES: CitationSource[] = [
  {
    id: 'oib-4',
    content: `[KB] ${FILE_NAME}, p.2\n${CITED_PASSAGE}`,
    citationKey: `${FILE_NAME}, p.2`,
    documentId: `doc:oib_knowledge:${FILE_NAME}`,
    fileName: FILE_NAME,
    collection: 'oib_knowledge',
    title: TITLE,
    origin: 'kb',
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    sourceType: 'knowledge_layer',
    page: 2,
    number: 1,
    isCited: true,
    snippet: CITED_PASSAGE,
    timestamp: new Date('2026-10-13T09:30:00'),
  },
]

const ClickOnLoad: FC<{ selector: string; then?: string }> = ({ selector, then }) => {
  useEffect(() => {
    let attempts = 0
    let timer = 0
    let step = selector
    const tick = (): void => {
      const target = document.querySelector<HTMLElement>(step)
      if (target) {
        target.click()
        if (then && step !== then) {
          step = then
          attempts = 0
          timer = window.setTimeout(tick, 50)
        }
        return
      }
      if (attempts++ > 120) return
      timer = window.setTimeout(tick, 50)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [selector, then])
  return null
}

const SelectOnLoad: FC<{ contains: string }> = ({ contains }) => {
  useEffect(() => {
    let attempts = 0
    let timer = 0
    const tick = (): void => {
      const run = [...document.querySelectorAll('.pdf-text-layer span')].find((span) =>
        span.textContent?.includes(contains)
      )
      const frame = document.querySelector('[data-testid="pdf-scroll"]')
      if (run && frame) {
        const range = document.createRange()
        range.selectNodeContents(run)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        frame.dispatchEvent(new Event('pointerup', { bubbles: true }))
        return
      }
      if (attempts++ > 120) return
      timer = window.setTimeout(tick, 50)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [contains])
  return null
}

const CitationPreview: FC<{ urls: Map<string, string> }> = ({ urls }) => {
  const [document] = buildCitationModel({ citations: SOURCES })
  const [activeLocus, setActiveLocus] = useState(document?.loci[0])
  if (!document) return null
  const target = resolveCitationTarget(document, { locus: activeLocus, baseCorpusFiles: [FILE_NAME] })
  if (target.kind !== 'document') return null
  return (
    <CitationDocumentDialog
      target={target}
      citation={{ document, locus: activeLocus }}
      activeLocus={activeLocus}
      onSelectLocus={setActiveLocus}
      src={urls.get('source')}
      open
      onOpenChange={() => {}}
      similarFixtures={{ load: answer, srcOf: (id) => urls.get(id) ?? '' }}
    />
  )
}

const SELECTION: SimilarPassagesRequest = {
  document: { kind: 'stored', documentId: 'doc-source' },
  passage: { text: CITED_PASSAGE, page: 2, cited: false },
  projectId: 'p-moedling',
}

const never: SimilarPassagesLoader = () => new Promise(() => {})
const nothing: SimilarPassagesLoader = async () => ({ origin: 'point', projectsSearched: 6, groups: [] })
const broken: SimilarPassagesLoader = async () => {
  throw new SimilarPassagesError(503, 'failed')
}
const held: SimilarPassagesLoader = async () => {
  throw new SimilarPassagesError(400, 'held')
}

const StatesPreview: FC = () => {
  const panes: Array<[string, SimilarPassagesLoader]> = [
    ['Suche läuft', never],
    ['Nichts gefunden', nothing],
    ['Fehlgeschlagen', broken],
    ['Dokument in Prüfung', held],
  ]
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {panes.map(([label, load]) => (
        <div key={label} className="flex h-[32rem] flex-col rounded-lg border border-border bg-background p-3">
          <SectionLabel as="p" className="mb-2">{label}</SectionLabel>
          <SimilarPassagesPanel
            request={SELECTION}
            opened={null}
            onOpen={() => {}}
            onBackToSource={() => {}}
            onClose={() => {}}
            load={load}
          />
        </div>
      ))}
    </div>
  )
}

export default function SimilarPassagesPreviewPage() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}

function Preview() {
  const variant = useSearchParams()?.get('variant')
  const urls = useBlobUrls()
  if (variant === 'states') {
    return (
      <div className="min-h-dvh bg-card p-6">
        <StatesPreview />
      </div>
    )
  }
  if (!urls) return null
  return (
    <div className="min-h-dvh bg-background p-6">
      {/* The marks at rest: the arrival pulse would make every capture a different frame. */}
      <style>{`.animate-passage-ping { animation: none; }`}</style>
      {variant === 'files' ? (
        <SimilarPassagesDialog
          request={SELECTION}
          source={{ src: urls.get('source') ?? '', fileName: 'Brandschutzkonzept.pdf', title: 'Brandschutzkonzept.pdf' }}
          onClose={() => {}}
          load={answer}
          srcOf={(id) => urls.get(id) ?? ''}
        />
      ) : (
        <CitationPreview urls={urls} />
      )}
      {variant === 'select' && <SelectOnLoad contains="Laufbreite" />}
      {(variant === null || variant === undefined || variant === 'opened') && (
        <ClickOnLoad selector="[data-find-similar]" then={variant === 'opened' ? '[data-similar-passage]' : undefined} />
      )}
    </div>
  )
}
