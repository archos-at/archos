import { NextResponse } from 'next/server'
import { ForbiddenError } from '@/lib/api/errors'
import { apiRoute } from '@/lib/api/handler'
import { PlatformAccessDeniedError } from '@/lib/authz/platform'
import { getLocale } from '@/i18n/server'
import { feedbackExportCopy } from '@/i18n/namespaces/feedback-export'
import { platformCopy } from '@/i18n/namespaces/platform'
import { requireFeedbackQuery } from '@/lib/feedback/query'
import { RATINGS_FILTER_PARAMS } from '@/lib/feedback/filters'
import { EXPORT_IGNORED_FILTERS_HEADER, EXPORT_TRUNCATED_HEADER } from '@/lib/feedback/types'
import {
  feedbackExportFileName,
  feedbackWeeklyFileName,
  getAnswerFeedbackExport,
  getAnswerFeedbackWeeklyExport,
} from '@/lib/feedback/export-service'
import { FEEDBACK_EXPORT_COLUMNS, FEEDBACK_WEEKLY_COLUMNS } from '@/lib/feedback/export-columns'
import { renderCsv } from '@/lib/feedback/export-csv'
import { renderFeedbackWorkbook } from '@/lib/feedback/export-workbook'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function download(
  body: string | Uint8Array,
  contentType: string,
  filename: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

const truncatedHeader = (truncated: boolean, cap: number): Record<string, string> =>
  truncated ? { [EXPORT_TRUNCATED_HEADER]: String(cap) } : {}

export const GET = apiRoute(
  async ({ request, session }) => {
    const searchParams = new URL(request.url).searchParams
    const query = requireFeedbackQuery(searchParams)
    const locale = await getLocale()
    const dictionary = { feedbackExport: feedbackExportCopy.messages[locale], platform: platformCopy.messages[locale] }
    try {
      if (searchParams.get('summary') === 'weekly') {
        const weekly = await getAnswerFeedbackWeeklyExport(session, query)
        const ignored = weekly.ignored.map((key) => RATINGS_FILTER_PARAMS[key]).join(',')
        return download(
          renderCsv(FEEDBACK_WEEKLY_COLUMNS, weekly.weeks, dictionary),
          'text/csv; charset=utf-8',
          feedbackWeeklyFileName(weekly),
          {
            ...truncatedHeader(weekly.truncated, weekly.cap),
            ...(ignored ? { [EXPORT_IGNORED_FILTERS_HEADER]: ignored } : {}),
          }
        )
      }

      const format = searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
      const exported = await getAnswerFeedbackExport(session, { query, withSummary: format === 'xlsx' })
      const body =
        format === 'xlsx'
          ? await renderFeedbackWorkbook(exported, dictionary)
          : renderCsv(FEEDBACK_EXPORT_COLUMNS, exported.records, dictionary)
      return download(
        body,
        format === 'xlsx' ? XLSX_TYPE : 'text/csv; charset=utf-8',
        feedbackExportFileName(exported, format),
        truncatedHeader(exported.truncated, exported.cap)
      )
    } catch (error) {
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenError()
      throw error
    }
  },
  {
    authz: {
      enforcedBy:
        'getAnswerFeedbackExport / getAnswerFeedbackWeeklyExport (requirePlatformPermission platform:organizations:view)',
    },
  }
)
