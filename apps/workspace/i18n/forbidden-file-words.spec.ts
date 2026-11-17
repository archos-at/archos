/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { de, en } from './dictionaries'

const FILE_NAMESPACES = [
  'files',
  'officeShelf',
  'uploadBatches',
  'knowledge',
  'onboarding',
  'projects',
  'projectIntake',
  'intakeShell',
  'intakeProjectStep',
  'intakeFilingStep',
  'intakeReadingStep',
  'intakeQuestionsStep',
  'intakeProfileStep',
  'bim',
  'common',
  'nav',
  'errors',
  'inboundMail',
  'mailThread',
] as const

const FORBIDDEN: Record<'de' | 'en', RegExp> = {
  de: /(?<![\p{L}-])(Plan|Pläne|Plänen|Plans|Planstand|Planstände|Planständen)(?![\p{L}-])/u,
  en: /(?<!\b(?:floor|site|development|zoning)\s)\bplans?\b(?!-)/i,
}

function leaves(node: unknown, path: string, found: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === 'string') found.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) leaves(value, path ? `${path}.${key}` : key, found)
  }
  return found
}

const REVISION_SUBTREES = [
  'files.lifecycle',
  'files.preview.revision',
  'files.revisionBadge',
  'files.compare',
  'chat.cards.documentDraft',
  'collaboration.inbox.review',
  'collaboration.inbox.types.documentReviewRequested',
  'collaboration.inbox.types.documentNewRevision',
  'files.folderUpload',
  'uploadBatches.summary.files',
  'inboundMail',
  'mailThread',
] as const

const REVISION_FORBIDDEN: Record<'de' | 'en', RegExp> = {
  de: /\bVersion(en)?\b|\bUpload \{|erbeten|Grundlage für Antworten/u,
  en: /\bversions?\b|\bupload \{|\bsuperseded\b|basis for answers/i,
}

function subtree(dictionary: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dictionary)
}

describe('a Fassung has one name and its status one word', () => {
  for (const [locale, dictionary] of [
    ['de', de],
    ['en', en],
  ] as const) {
    it(`${locale}: no „Version“, „Upload N“ or „erbeten“ where a Fassung is named`, () => {
      const offenders = REVISION_SUBTREES.flatMap((path) => {
        const node = subtree(dictionary, path)
        expect(node, `${path} moved; update REVISION_SUBTREES`).toBeTypeOf('object')
        return leaves(node, path)
      })
        .filter(([, text]) => REVISION_FORBIDDEN[locale].test(text.replace(/\{\w+\}/g, '{}')))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders).toEqual([])
    })
  }
})

describe('file copy never calls a file a plan', () => {
  for (const [locale, dictionary] of [
    ['de', de],
    ['en', en],
  ] as const) {
    it(`${locale}: no „Plan“ wording in the file namespaces`, () => {
      expect(FILE_NAMESPACES.filter((ns) => !(ns in dictionary))).toEqual([])
      const scanned = FILE_NAMESPACES
      const offenders = scanned
        .flatMap((ns) => leaves((dictionary as Record<string, unknown>)[ns], ns))
        .filter(([, text]) => FORBIDDEN[locale].test(text))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders).toEqual([])
    })
  }
})

const MAIL_NAMESPACES = ['inboundMail', 'mailThread', 'files.inboundMail', 'nav.inboundMailWaiting', 'projects.card.mailWaiting'] as const
const MAIL_NOTICE_PATHS = [
  ...[
    'Waiting',
    'Expiring',
    'Decided',
    'Held',
    'HeldForWriters',
    'Rejected',
    'Expired',
    'FilingFailed',
    'CapReached',
    'Appended',
  ].map((type) => `collaboration.inbox.types.inboundMail${type}`),
  'collaboration.inbox.types.mailThreadFollowExpiring',
  'settings.project.documents.inboundMailTitle',
  'settings.project.documents.inboundMailDescription',
] as const

const MAIL_FORBIDDEN: Record<'de' | 'en', RegExp> = {
  de: /Projektadresse|Posteingang|Postfach|Quarantäne|Durchsicht|durchsehen|annehmen|ablehnen|freigeben|zulassen|\bNachrichte?n?\b|\bThreads?\b|Unterhaltung|\bInbox\b|Schriftverkehr|abonnieren|(?<!E-Mail-)\bVerl(?:auf|äufe)\b(?! folgen\))|von selbst|automatisch abgelegt|Schreibrecht|Kolleg/u,
  en: /\binbox\b|\bintake\b|project address|\bmessages?\b|(?<!mail )\bthreads?\b|\bapprove|\bdecline|\baccept(?!ed)|\bquarantine|by itself|colleague|email thread/i,
}

describe('the E-Mail-Eingang keeps its own words', () => {
  for (const [locale, dictionary] of [
    ['de', de],
    ['en', en],
  ] as const) {
    it(`${locale}: no word the vocabulary gave to something else`, () => {
      const offenders = MAIL_NAMESPACES.flatMap((path) => {
        const node = subtree(dictionary, path)
        expect(node, `${path} moved; update MAIL_NAMESPACES`).toBeDefined()
        return leaves(node, path)
      })
        .filter(([, text]) => MAIL_FORBIDDEN[locale].test(text))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders).toEqual([])
    })

    it(`${locale}: the Postfach's notices and the settings card about mail keep the same words`, () => {
      const offenders = MAIL_NOTICE_PATHS.flatMap((path) => {
        const node = subtree(dictionary, path)
        expect(node, `${path} moved; update MAIL_NOTICE_PATHS`).toBeDefined()
        return leaves(node, path)
      })
        .filter(([, text]) => MAIL_FORBIDDEN[locale].test(text.replaceAll('Postfach', '')))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders).toEqual([])
    })
  }

  it('de: „Abgelegt“ is never a mail\'s state', () => {
    const offenders = MAIL_NAMESPACES.flatMap((path) => leaves(subtree(de, path), path))
      .filter(([, text]) => /^\s*Abgelegt\s*$/u.test(text))
      .map(([path, text]) => `${path}: ${text}`)
    expect(offenders).toEqual([])
  })
})
