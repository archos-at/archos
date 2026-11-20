// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 *
 * Text written for a log must not reach a person's screen.
 *
 * Every error string the server, the knowledge layer or a transport writes is
 * English and meant for whoever reads the log: an API envelope's `error`, a
 * stored ingest failure (`pdf_pages_unreadable: 7 of 12 pages could not be
 * read`), an exception's `.message`. A German office onboarding to the workspace read
 * such strings in the middle of its project setup and reported that „the
 * language jumped to English" (19.10.2026). The words have to come from the
 * dictionary, with the raw text in the console or behind a „Details" disclosure.
 *
 * This reads the source and refuses the two shapes that put it on screen:
 *
 *  - a stored `errorMessage` rendered as a JSX child: say it through
 *    `IngestFailureNotice` (an ingest failure) or write a dictionary sentence
 *    into it (`features/documents/lib/upload-failure.ts`, an upload's);
 *  - a toast built from a response body's `error`: toast the dictionary key,
 *    and `console.warn` the body.
 *
 * Each allowance names why its text is already the reader's language, or why
 * it is debt off the project path. Shrink the lists; do not grow them.
 */

import { describe, expect, it } from 'vitest'
import { lineOf, nodesOf, parseSource, parseSourceText, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ROOT = process.cwd()

const ERROR_MESSAGE_CHILD_ALLOWED: Record<string, string> = {
  'features/documents/components/upload-tray.tsx':
    'the upload-failure branch only: use-file-upload writes that text through uploadFailureSentence (dictionary); the ingest branch goes through IngestFailureNotice',
  'features/documents/components/FileUploadZone.tsx':
    'the upload-failure branch only, as in upload-tray; the ingest branch goes through IngestFailureNotice',
}

const TOAST_OF_BODY_ALLOWED: Record<string, string> = {
}

const TOAST_METHODS = new Set(['error', 'warning', 'info', 'message'])

function isPlainPath(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression) || expression.kind === ts.SyntaxKind.ThisKeyword) return true
  return ts.isPropertyAccessExpression(expression) && isPlainPath(expression.expression)
}

function isStoredErrorMessage(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'errorMessage' && isPlainPath(expression.expression)
}

function renderedErrorMessages(source: ts.SourceFile): ts.Node[] {
  const children = nodesOf(source, ts.isJsxExpression).filter(
    (child) =>
      (ts.isJsxElement(child.parent) || ts.isJsxFragment(child.parent)) &&
      child.expression !== undefined &&
      isStoredErrorMessage(child.expression),
  )
  const spans = nodesOf(source, ts.isTemplateSpan).filter((span) => isStoredErrorMessage(span.expression))
  return [...children, ...spans]
}

function toastsBodyError(source: ts.SourceFile): ts.Node[] {
  return nodesOf(source, ts.isCallExpression).filter((call) => {
    const callee = call.expression
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false
    if (callee.expression.text !== 'toast' || !TOAST_METHODS.has(callee.name.text)) return false
    const [first] = call.arguments
    if (!first) return false
    let leading: ts.Expression = first
    while (ts.isBinaryExpression(leading)) leading = leading.left
    return ts.isPropertyAccessExpression(leading) && leading.name.text === 'error' && ts.isIdentifier(leading.expression)
  })
}

const sources = srcEntries(ROOT)
  .filter((key) => /\.tsx?$/.test(key) && !/\.(spec|test)\.tsx?$/.test(key))
  .filter((key) => !key.split('/').slice(0, -1).includes('dev'))
  .map((key) => ({ key, source: parseSource(srcPath(key, ROOT)) }))

function offenders(find: (source: ts.SourceFile) => ts.Node[], allowed: Record<string, string>): string[] {
  return sources.flatMap(({ key, source }) =>
    key in allowed ? [] : find(source).map((node) => `${key}:${lineOf(node)}: ${node.getText(source)}`),
  )
}

describe('raw error text on screen', () => {
  it('renders no stored errorMessage as text outside the surfaces that write it from the dictionary', () => {
    expect(offenders(renderedErrorMessages, ERROR_MESSAGE_CHILD_ALLOWED)).toEqual([])
  })

  it('toasts no response body’s English error', () => {
    expect(offenders(toastsBodyError, TOAST_OF_BODY_ALLOWED)).toEqual([])
  })

  it('keeps every allowance live, so a fixed file leaves the list', () => {
    const stale = [
      ...Object.keys(ERROR_MESSAGE_CHILD_ALLOWED).filter(
        (path) => !sources.some((file) => file.key === path && renderedErrorMessages(file.source).length > 0),
      ),
      ...Object.keys(TOAST_OF_BODY_ALLOWED).filter(
        (path) => !sources.some((file) => file.key === path && toastsBodyError(file.source).length > 0),
      ),
    ]
    expect(stale).toEqual([])
  })

  it('catches the shapes it is meant to catch', () => {
    const renders = (text: string) => renderedErrorMessages(parseSourceText(text)).length > 0
    const toasts = (text: string) => toastsBodyError(parseSourceText(text)).length > 0
    expect(renders('<p className="text-error">{file.errorMessage}</p>')).toBe(true)
    expect(renders('<Notice errorMessage={file.errorMessage} />')).toBe(false)
    expect(toasts("toast.error(body?.error ?? t('x'))")).toBe(true)
    expect(toasts("toast.error(t('x'))")).toBe(false)
  })
})
