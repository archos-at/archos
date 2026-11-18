'use client'

import { appReturnPath } from '@/lib/utils/same-origin-path'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { openFiledDocument } from './open-filed-document'
import { documentFilesHref } from './document-question'

export const REVIEW_PARAM = 'review'
export const MARK_PARAM = 'mark'
export const DOC_PARAM = 'doc'
export const TOOL_PARAM = 'tool'
export const BACK_PARAM = 'back'

export type ReviewLinkTool = 'point' | 'region'
const isReviewLinkTool = (value: string | null | undefined): value is ReviewLinkTool =>
  value === 'point' || value === 'region'

export interface ReviewTarget {
  documentId: string
  annotationId?: string | null
  tool?: ReviewLinkTool | null
}

export interface ReviewParams {
  documentId: string | null
  open: boolean
  annotationId: string | null
  tool: ReviewLinkTool | null
  back: string | null
}

export function readReviewParams(params: Pick<URLSearchParams, 'get'> | null | undefined): ReviewParams {
  const open = Boolean(params?.get(REVIEW_PARAM))
  const tool = params?.get(TOOL_PARAM)
  return {
    documentId: params?.get(DOC_PARAM) || null,
    open,
    annotationId: open ? params?.get(MARK_PARAM) || null : null,
    tool: open && isReviewLinkTool(tool) ? tool : null,
    back: open ? appReturnPath(params?.get(BACK_PARAM)) : null,
  }
}

export function clearReviewParams(params: URLSearchParams): URLSearchParams {
  params.delete(REVIEW_PARAM)
  params.delete(MARK_PARAM)
  params.delete(TOOL_PARAM)
  params.delete(BACK_PARAM)
  return params
}

export const hrefWithParams = (pathname: string, params: URLSearchParams): string => {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export type ReviewLocation = Pick<Location, 'pathname' | 'search' | 'hash'>

export function setReviewParams(
  params: URLSearchParams,
  target: ReviewTarget,
  { withDocument }: { withDocument: boolean }
): URLSearchParams {
  if (withDocument) params.set(DOC_PARAM, target.documentId)
  params.set(REVIEW_PARAM, '1')
  if (target.annotationId) params.set(MARK_PARAM, target.annotationId)
  else params.delete(MARK_PARAM)
  if (target.tool) params.set(TOOL_PARAM, target.tool)
  else params.delete(TOOL_PARAM)
  return params
}

export function reviewHrefAt(
  location: ReviewLocation,
  target: ReviewTarget,
  { withDocument = false }: { withDocument?: boolean } = {}
): string {
  const params = setReviewParams(new URLSearchParams(location.search), target, { withDocument })
  return `${location.pathname}?${params.toString()}${location.hash}`
}

export function reviewFilesHref(projectId: string, target: ReviewTarget, { back }: { back?: string | null } = {}): string {
  const base = documentFilesHref(projectId, target.documentId)
  const [path, search = ''] = base.split('?')
  const params = setReviewParams(new URLSearchParams(search), target, { withDocument: true })
  return withReviewBack(`${path}?${params.toString()}`, back)
}

export function withBack(href: string, back: string | null | undefined): string {
  return withBackWhen(href, back, () => true)
}

export function withReviewBack(href: string, back: string | null | undefined): string {
  return withBackWhen(href, back, (params) => Boolean(params.get(REVIEW_PARAM)))
}

function withBackWhen(href: string, back: string | null | undefined, applies: (params: URLSearchParams) => boolean): string {
  const path = appReturnPath(back)
  const [base, hash = ''] = href.split('#')
  const [pathname, search = ''] = base.split('?')
  const params = new URLSearchParams(search)
  if (!path || !applies(params)) return href
  params.set(BACK_PARAM, path)
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`
}

export function readDocumentBack(params: Pick<URLSearchParams, 'get'> | null | undefined): string | null {
  if (!params?.get(DOC_PARAM)) return null
  return appReturnPath(params.get(BACK_PARAM))
}

export const isProjectChatPath = (pathname: string): boolean => /^\/app\/projects\/[^/]+\/chat\/?$/.test(pathname)

export interface DocumentBesideOptions {
  projectId: string
  projectName?: string | null
  canCollaborate?: boolean
}

export async function showDocumentBeside(documentId: string, options: DocumentBesideOptions): Promise<boolean> {
  const preview = useFilePreviewStore.getState()
  if (preview.file?.id === documentId) {
    if (preview.hidden || preview.mode === 'modal') preview.peek()
    return true
  }
  return openFiledDocument({
    documentId,
    projectId: options.projectId,
    projectName: options.projectName,
    canCollaborate: options.canCollaborate,
  })
}

export interface OpenReviewOptions extends DocumentBesideOptions {
  navigate: (href: string, how: 'replace' | 'push') => void
  location?: ReviewLocation
}

export type OpenReviewResult = 'beside' | 'files' | 'unavailable'

export async function openReviewAt(target: ReviewTarget, options: OpenReviewOptions): Promise<OpenReviewResult> {
  const location = options.location ?? window.location
  if (!isProjectChatPath(location.pathname)) {
    options.navigate(reviewFilesHref(options.projectId, target), 'push')
    return 'files'
  }
  if (!(await showDocumentBeside(target.documentId, options))) return 'unavailable'
  options.navigate(reviewHrefAt(location, target), 'replace')
  return 'beside'
}
