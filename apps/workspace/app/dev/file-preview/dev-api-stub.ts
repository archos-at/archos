import { normalizeDrawingStructured } from '@/lib/documents/drawing-structured'
import { a1SheetPdf } from '../_fixtures/a1-sheet'
import { buildPdf } from '../_fixtures/sample-pdf'
import { DEV_STRUCTURED_RAW, DRAWING_FIXTURE } from './drawing-fixtures'
import { SEARCH_HIT_FIXTURE } from './fixtures'
import { FIRE_SAFETY_PAGES, ROOM_PROGRAMME_PAGES, searchHitPages } from './pdf-page-fixtures'
import { REVIEW_VERSIONS } from './review-fixtures'
import { SETTLING_FIXTURE, settlingReads, settlingStatus } from './settling-preview'
import { CSV_BODY, MARKDOWN_BODY, TEXT_BODY } from './text-fixtures'
import { MAIL_ATTACHMENT_FILE, MAIL_ATTACHMENT_VERSIONS, MAIL_PROJECT_ID, MAIL_THREAD_FILE, MAIL_THREAD_MARKDOWN, MAIL_THREAD_VERSIONS, MAIL_THREAD_VIEW } from './mail-fixtures'

const PAGE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="700" viewBox="0 0 520 700">
       <rect width="520" height="700" fill="#ffffff"/>
       <rect x="40" y="48" width="240" height="16" rx="3" fill="#1c1b19"/>
       <rect x="40" y="76" width="150" height="10" rx="3" fill="#a8a5a1"/>
       <rect x="40" y="128" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="150" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="172" width="360" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="230" width="440" height="220" rx="6" fill="none" stroke="#cfcbc6" stroke-width="2" stroke-dasharray="6 6"/>
       <path d="M120 400 L200 300 L280 360 L360 280 L440 380" fill="none" stroke="#57534e" stroke-width="3"/>
       <rect x="40" y="500" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="522" width="400" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="544" width="420" height="8" rx="3" fill="#dedbd7"/>
     </svg>`
  )

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __filePreviewShim?: boolean }
  if (!w.__filePreviewShim) {
    w.__filePreviewShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const mail = mailThreadAnswer(url)
      if (mail) return mail
      const officeMatch = /\/api\/documents\/dev-doc-(office-[a-z]+)\/preview$/.exec(url)
      if (officeMatch?.[1] === 'office-converting') {
        return new Promise<Response>(() => {})
      }
      if (officeMatch?.[1] === 'office-failed') {
        return Response.json({ code: 'RENDITION_FAILED' }, { status: 502 })
      }
      if (officeMatch) {
        return Response.json({
          url: PAGE_SVG,
          contentType: 'application/pdf',
          rendition: true,
          sourceContentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      }
      const fileMatch = /\/api\/documents\/(.+)\/file$/.exec(url)
      if (fileMatch?.[1] === DRAWING_FIXTURE.id) {
        return new Response(a1SheetPdf('C'), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (fileMatch?.[1] === SEARCH_HIT_FIXTURE.id) {
        return new Response(buildPdf(searchHitPages()), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (fileMatch?.[1] === 'dev-doc-pdf-unreadable') {
        return new Response('upstream unavailable', { status: 500 })
      }
      if (fileMatch) {
        const pages =
          fileMatch[1] === 'dev-doc-office-converted' ? ROOM_PROGRAMME_PAGES : FIRE_SAFETY_PAGES
        return new Response(buildPdf(pages), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (/\/api\/documents\/.+\/preview$/.test(url)) {
        return Response.json({ url: PAGE_SVG })
      }
      const textMatch = /\/api\/documents\/(.+)\/text$/.exec(url)
      if (textMatch) {
        const body =
          textMatch[1] === 'dev-doc-csv'
            ? CSV_BODY
            : textMatch[1] === 'dev-doc-txt'
              ? TEXT_BODY
              : MARKDOWN_BODY
        return Response.json({ text: body, truncated: textMatch[1] === 'dev-doc-txt' })
      }
      if (/\/api\/documents\/.+\/versions\/reviewers$/.test(url)) {
        return Response.json({
          candidates: [
            { userId: 'u-1', name: 'Miriam Hofer' },
            { userId: 'u-2', name: 'Anna Berger' },
          ],
        })
      }
      if (/\/api\/documents\/.+\/versions$/.test(url)) {
        return Response.json(REVIEW_VERSIONS)
      }
      if (url.endsWith(`/api/documents/${SETTLING_FIXTURE.id}/status`)) {
        return Response.json(settlingStatus())
      }
      if (url.endsWith(`/api/documents/${SETTLING_FIXTURE.id}/visual-details`) && settlingReads < 4) {
        return Response.json({ details: [] })
      }
      if (/\/api\/documents\/.+\/visual-details$/.test(url)) {
        return Response.json({
          details: [
            {
              page: 3,
              contentType: 'drawing',
              drawingType: 'site_plan',
              scale: '1:500',
              segment: 0,
              text: 'Lageplan mit Feuerwehraufstellflächen, Löschwasserentnahmestellen und Zufahrten.',
              structured: null,
            },
            {
              page: 7,
              contentType: 'drawing',
              drawingType: 'floor_plan',
              scale: '1:100',
              segment: 0,
              text: 'Regelgeschoss mit eingetragenen Fluchtwegen und Brandabschnittsgrenzen (REI 90).',
              structured: normalizeDrawingStructured(DEV_STRUCTURED_RAW),
            },
            {
              page: 7,
              contentType: 'drawing',
              drawingType: 'section',
              scale: '1:50',
              segment: 1,
              text: 'Querschnitt durch das Atrium mit Galerieebenen und Oberlicht.',
              structured: null,
            },
          ],
        })
      }
      return real(input, init)
    }
  }
}

const mailThreads = `/api/projects/${encodeURIComponent(MAIL_PROJECT_ID)}/mail-threads`

function mailThreadAnswer(url: string): Response | null {
  const path = url.split('?')[0]
  if (path.endsWith(mailThreads)) {
    const summary = { id: MAIL_THREAD_VIEW.id, documentId: MAIL_THREAD_VIEW.documentId, name: MAIL_THREAD_VIEW.name, entryCount: MAIL_THREAD_VIEW.entryCount, lastEntryAt: MAIL_THREAD_VIEW.lastEntryAt, followed: false }
    const asked = new URL(url, 'http://dev').searchParams.get('documentId')
    return Response.json({ items: !asked || asked === MAIL_THREAD_VIEW.documentId ? [summary] : [], nextCursor: null })
  }
  if (path.endsWith(`${mailThreads}/${encodeURIComponent(MAIL_THREAD_VIEW.id)}`)) return Response.json(MAIL_THREAD_VIEW)
  if (path.endsWith(`/api/documents/${MAIL_THREAD_FILE.id}/text`)) return Response.json({ text: MAIL_THREAD_MARKDOWN, truncated: false })
  if (path.endsWith(`/api/documents/${MAIL_THREAD_FILE.id}/versions`)) return Response.json(MAIL_THREAD_VERSIONS)
  if (path.endsWith(`/api/documents/${MAIL_ATTACHMENT_FILE.id}/versions`)) return Response.json(MAIL_ATTACHMENT_VERSIONS)
  return null
}
