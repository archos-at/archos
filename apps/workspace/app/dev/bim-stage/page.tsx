'use client'

import type { JSX } from 'react'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { ModelStage } from '@/features/bim/components/model-stage'
import type { BimModelHeaderView } from '@/features/bim/hooks/use-bim-model'
import { ELEMENTS, SELECTED, SUMMARY } from '../_bim-fixtures'

const PROJECT_ID = 'dev-project'

const MODEL: BimModelHeaderView = {
  id: 'model-v3',
  documentId: 'doc-v3',
  projectId: PROJECT_ID,
  filename: 'wohnhaus-beispielgasse_V3.ifc',
  displayName: null,
  status: 'ready',
  schemaVersion: 'IFC4',
  elementCount: ELEMENTS.length,
  errorMessage: null,
  summary: SUMMARY,
  updatedAt: '2026-05-04T09:30:15.400Z',
}

const LONG_GLOBAL_ID = '1kTvXnbbzCWw8lcMd1dR4o'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __bimStageShim?: boolean }
  if (!w.__bimStageShim) {
    w.__bimStageShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/query')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { op?: string; globalId?: string }
        if (body.op === 'elements') {
          return Response.json({ elements: ELEMENTS, total: ELEMENTS.length })
        }
        if (body.op === 'element') {
          return Response.json({
            element: { ...SELECTED, globalId: body.globalId ?? LONG_GLOBAL_ID },
          })
        }
        return new Response(null, { status: 404 })
      }
      if (url.endsWith('/dev/bim-stage/none.ifc') && /[?&]load=slow\b/.test(window.location.search)) {
        return new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-length': String(120_000_000) },
        })
      }
      if (url.includes('/source')) return Response.json({ url: '/dev/bim-stage/none.ifc' })
      if (url.includes('/bim/models')) return Response.json({ models: [MODEL] })
      if (url.includes('/profile')) return Response.json({ facts: {} })
      return real(input, init)
    }
  }
}

export default function BimStageDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense fallback={null}>
        <ModelStage projectId={PROJECT_ID} onClose={() => {}} canCollaborate={false} />
      </Suspense>
    </I18nProvider>
  )
}
