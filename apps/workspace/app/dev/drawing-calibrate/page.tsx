'use client'

import { useEffect, useMemo, useRef, type FC, type ReactNode } from 'react'
import { Ruler } from 'lucide-react'
import { I18nProvider } from '@/i18n'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  FloatingToolbar,
  ToolbarDivider,
  ToolbarIconButton,
} from '@/components/ui/floating-toolbar'
import { PageSheet } from '@/features/knowledge/components/pdf-viewer-atoms'
import { CalibrationPageLayer } from '@/features/documents/components/review/calibration-page-layer'
import { ScaleControl } from '@/features/documents/components/review/measure/scale-control'
import { useReviewCalibration } from '@/features/documents/hooks/use-review-calibration'
import type {
  CalibrationPoint,
  CalibrationRegion,
  CalibrationView,
} from '@/lib/drawing-calibrations/wire'
import {
  CROSSING_REGION,
  DETAIL_SCALE,
  DOCUMENT_ID,
  fixtureClient,
  LAYOUT_REGION,
  LAYOUT_SCALE,
  PAGE_SCALE,
  SHEET,
  SPAN_FROM,
  SPAN_TO,
} from '../_fixtures/drawing-calibrate'

const SheetDrawing: FC = () => (
  <svg aria-hidden viewBox="0 0 1000 706" className="absolute inset-0 size-full text-neutral-800">
    <g fill="none" stroke="currentColor">
      <rect x="150" y="190" width="420" height="330" strokeWidth="3" />
      <path
        d="M270 190v150h-120M270 340v180M400 190v120h170M400 310v210M330 400h70"
        strokeWidth="1.5"
      />
      <path
        d="M300 420h60v70h-60zM310 420v70M320 420v70M330 420v70M340 420v70M350 420v70"
        strokeWidth="0.8"
      />
      <path d="M150 141h420M150 131v20M400 131v20M570 131v20" strokeWidth="1" />
      <rect x="720" y="150" width="190" height="130" strokeWidth="2" />
      <path d="M720 195h190M720 215h190M760 150v130M790 150v130" strokeWidth="1" />
      <rect x="700" y="560" width="260" height="100" strokeWidth="1.5" />
      <path d="M700 590h260M700 625h260M830 590v70" strokeWidth="0.8" />
    </g>
    <g fill="currentColor" fontFamily="ui-sans-serif, system-ui" fontSize="13">
      <text x="258" y="134">
        21,00
      </text>
      <text x="468" y="134">
        14,28
      </text>
      <text x="184" y="270">
        Wohnen
      </text>
      <text x="314" y="270">
        Küche
      </text>
      <text x="462" y="256">
        Zimmer
      </text>
      <text x="150" y="552" fontSize="12">
        Grundriss 1. Obergeschoss
      </text>
      <text x="720" y="304" fontSize="12">
        Detail Attika 1:20
      </text>
      <text x="712" y="581" fontSize="11">
        Wohnhaus Lindengasse
      </text>
      <text x="712" y="612" fontSize="11">
        Einreichung
      </text>
    </g>
  </svg>
)

interface Draft {
  from: CalibrationPoint
  to: CalibrationPoint
  region: CalibrationRegion
  lengthM: number
}

const SETTING: Draft = { from: SPAN_FROM, to: SPAN_TO, region: LAYOUT_REGION, lengthM: 21 }
const CROSSING: Draft = {
  from: { x: 0.69, y: 0.3 },
  to: { x: 0.8, y: 0.3 },
  region: CROSSING_REGION,
  lengthM: 1.4,
}

const Scenario: FC<{
  saved: readonly CalibrationView[]
  canCalibrate?: boolean
  draft?: Draft
  open?: boolean
  width: number
}> = ({ saved, canCalibrate = true, draft, open = false, width }) => {
  const client = useMemo(() => fixtureClient(saved, canCalibrate), [saved, canCalibrate])
  const calibration = useReviewCalibration(
    {
      documentId: DOCUMENT_ID,
      load: 'ready',
      tool: 'measure',
      me: 'user_me',
      annotations: [{ createdBy: 'user_anna', createdByName: 'Anna Berger' }],
    },
    { client }
  )
  const { shown, pageSizes, setOpen, beginSetting, pick, drawRegion, setLength } = calibration
  const seeded = useRef(false)
  useEffect(() => {
    if (!shown || !pageSizes[1] || seeded.current) return
    seeded.current = true
    if (open) setOpen(true)
    if (!draft) return
    beginSetting(1)
    pick(1, draft.from)
    pick(1, draft.to)
    drawRegion(1, draft.region)
    setLength(draft.lengthM)
  }, [shown, pageSizes, open, draft, setOpen, beginSetting, pick, drawRegion, setLength])

  return (
    <div className="bg-desk rounded-surface relative p-4 pt-16" style={{ width }}>
      <FloatingToolbar className="absolute top-3 left-1/2 -translate-x-1/2">
        <ToolbarIconButton aria-label="Messen" aria-pressed>
          <Ruler aria-hidden />
        </ToolbarIconButton>
        <ToolbarDivider />
        <ScaleControl calibration={calibration} page={1} />
      </FloatingToolbar>
      <PageSheet
        data-page={1}
        data-page-width-pt={SHEET.width}
        data-page-height-pt={SHEET.height}
        style={{ width: width - 32, height: ((width - 32) * SHEET.height) / SHEET.width }}
      >
        <SheetDrawing />
        <CalibrationPageLayer page={1} calibration={calibration} />
      </PageSheet>
    </div>
  )
}

const SCENARIOS: readonly {
  id: string
  title: string
  note: string
  saved: readonly CalibrationView[]
  draft?: Draft
  open?: boolean
  canCalibrate?: boolean
}[] = [
  {
    id: 'none',
    title: 'Ohne Maßstab',
    note: 'Der Knopf in der Leiste sagt es; das Popover bietet „Maßstab festlegen“.',
    saved: [],
    open: true,
  },
  {
    id: 'one',
    title: 'Ein Maßstab',
    note: 'Eine Zeile: Verhältnis, Länge, Rahmen, wer, wann. Auf der Seite leise sein Rahmen.',
    saved: [LAYOUT_SCALE],
    open: true,
  },
  {
    id: 'nested',
    title: 'Zwei Maßstäbe, ineinander',
    note: 'Die ganze Seite 1:200, darin das Detail 1:20: der kleinste Rahmen um einen Punkt gilt.',
    saved: [PAGE_SCALE, DETAIL_SCALE],
    open: true,
  },
  {
    id: 'setting',
    title: 'Maßstab wird festgelegt',
    note: 'Zwei Punkte, der Rahmen, die Länge: 1:100 steht da, bevor gespeichert wird.',
    saved: [],
    draft: SETTING,
  },
  {
    id: 'overlap',
    title: 'Rahmen schneidet einen Maßstab',
    note: 'Schon vor dem Speichern: der Rahmen schneidet das Detail 1:20, Speichern geht nicht.',
    saved: [LAYOUT_SCALE, DETAIL_SCALE],
    draft: CROSSING,
  },
  {
    id: 'read-only',
    title: 'Ohne Recht, den Maßstab festzulegen',
    note: 'Die Maßstäbe ohne ihre Knöpfe, und warum.',
    saved: [LAYOUT_SCALE],
    open: true,
    canCalibrate: false,
  },
]

const Preview: FC = () => {
  const wide = useMediaQuery('(min-width: 48rem)')
  return (
    <main
      data-testid="drawing-calibrate-preview"
      className="bg-background text-foreground mx-auto flex w-full max-w-[1160px] flex-col gap-12 p-4 sm:p-8"
    >
      <header className="grid gap-1">
        <h1 className="text-page-title">Maßstab einer Zeichnung</h1>
        <p className="text-muted-foreground max-w-[72ch] text-sm">
          Das Popover des Maßstabs im Messmodus der Prüfansicht, über einer A1-Seite. Die Leiste
          oben ist ein Platzhalter für die Messleiste. Am Schreibtisch und auf dem Telefon (390 px).
        </p>
      </header>
      {SCENARIOS.map(({ id, title, note, ...scenario }) => (
        <section key={id} data-testid={`calibrate-scenario-${id}`} className="grid gap-3">
          <div className="grid gap-0.5">
            <h2 className="text-section">{title}</h2>
            <p className="text-muted-foreground text-meta">{note}</p>
          </div>
          <div className="flex flex-wrap items-start gap-8 pb-80">
            {wide && <Scenario {...scenario} width={680} />}
            <Scenario {...scenario} width={358} />
          </div>
        </section>
      ))}
    </main>
  )
}

export default function DrawingCalibratePreviewPage(): ReactNode {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
