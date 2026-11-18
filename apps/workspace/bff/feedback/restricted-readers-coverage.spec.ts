// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { calleeName, callsTo, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { srcKey } from '@/test-utils/source-tree'
import { tokenizeSql, type SqlToken } from '@/test-utils/sql-statements'
import { NO_RATINGS_FILTERS, type FeedbackQuery } from './filters'
import { isRestrictedUseVote } from './repository'
import { OUTSIDE_RESTRICTED_USE, voteScope } from './vote-scope'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

type Classification = { rule: true } | { tenant: string } | { presenceOnly: string }

const READERS: Record<string, Classification> = {
  'lib/feedback/repository.ts::upsertAnswerFeedback': {
    tenant: "The caller's own vote, written and returned in the caller's tenant.",
  },
  'lib/feedback/repository.ts::getAnswerFeedbackForUser': {
    tenant: "The caller's own prior vote, read in the caller's tenant before an upsert.",
  },
  'lib/feedback/repository.ts::listAnswerFeedbackForConversation': {
    tenant: "The caller's own votes in one conversation, for the chat's own hydration.",
  },
  'lib/feedback/repository.ts::listFeedbackTurns': { rule: true },
  'lib/feedback/export-repository.ts::listFeedbackExportRows': { rule: true },
  'lib/feedback/export-repository.ts::getFeedbackFacets': {
    presenceOnly:
      'Counts the votes with a comment or an expected answer (`nullif(btrim(…)) is not null`); no word of either leaves the query.',
  },
  'lib/feedback/service.ts::scoreVoteInLangfuse': { rule: true },
  'lib/platform-lessons/repository.ts::listUnprocessedDownvotes': { rule: true },
}

const RULE_NAMES = new Set([
  'OUTSIDE_RESTRICTED_USE',
  'feedback_restricted_use',
  'grid_feedback_restricted_use',
  'isRestrictedUseVote',
])

const COLUMN_ACCESSES = new Set(['answerFeedback.comment', 'answerFeedback.expectedAnswer'])

interface Unit {
  key: string
  name: string
  node: ts.Node
}

interface Code {
  tokens: SqlToken[]
  accesses: string[]
  calls: string[]
  selectsWholeRow: boolean
}

interface Scan {
  readers: Map<string, Unit>
  byName: Map<string, Unit[]>
  units: Unit[]
}

function unitsOf(rel: string, source: ts.SourceFile): Unit[] {
  const units: Unit[] = []
  const add = (name: string, node: ts.Node) => units.push({ key: `${rel}::${name}`, name, node })
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) add(statement.name?.text ?? 'default', statement)
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, declaration)
      }
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        const name = member.name && ts.isIdentifier(member.name) ? member.name.text : 'member'
        add(`${statement.name?.text ?? 'default'}.${name}`, member)
      }
    }
  }
  return units
}

function codeOf(node: ts.Node): Code {
  const sql: string[] = []
  const accesses: string[] = []
  const calls: string[] = []
  let selectsWholeRow = false
  walk(node, (child) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      sql.push(child.text)
    }
    if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)) {
      accesses.push(`${child.expression.text}.${child.name.text}`)
    }
    if (ts.isCallExpression(child)) {
      const name = calleeName(child)
      if (name) calls.push(name)
      if ((name === 'select' || name === 'returning') && child.arguments.length === 0) selectsWholeRow = true
    }
  })
  return { tokens: tokenizeSql(sql.join('\n')).flat(), accesses, calls, selectsWholeRow }
}

function identifiersOf(node: ts.Node): string[] {
  const names: string[] = []
  walk(node, (child) => {
    if (ts.isIdentifier(child)) names.push(child.text)
  })
  return names
}

function wordsOf(tokens: SqlToken[]): string[] {
  return tokens.filter((token) => token.kind === 'word').map((token) => token.text)
}

function selectsEveryColumn(tokens: SqlToken[]): boolean {
  return tokens.some((token, at) => {
    const word = token.kind === 'word' ? token.text.toLowerCase() : ''
    return (
      (word === 'select' && tokens[at + 1]?.text === '*') ||
      (word === 'f' && tokens[at + 1]?.text === '.' && tokens[at + 2]?.text === '*')
    )
  })
}

function readsWords(unit: Unit): boolean {
  const code = codeOf(unit.node)
  const words = wordsOf(code.tokens).map((word) => word.toLowerCase())
  const votes = words.includes('answer_feedback') || code.calls.includes('voteScope')
  if (votes && (words.includes('comment') || words.includes('expected_answer') || selectsEveryColumn(code.tokens))) {
    return true
  }
  if (code.accesses.some((access) => COLUMN_ACCESSES.has(access))) return true
  if (code.selectsWholeRow && identifiersOf(unit.node).includes('answerFeedback')) return true
  return code.calls.includes('upsertFeedbackScore')
}

function scopedToContentBearing(node: ts.Node): boolean {
  return callsTo(node, 'voteScope').some((call) =>
    call.arguments.some(
      (argument) =>
        ts.isObjectLiteralExpression(argument) &&
        argument.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'contentBearing' &&
            property.initializer.kind === ts.SyntaxKind.TrueKeyword,
        ),
    ),
  )
}

function asksRule(unit: Unit): boolean {
  const names = [...wordsOf(codeOf(unit.node).tokens), ...identifiersOf(unit.node)]
  return names.some((name) => RULE_NAMES.has(name)) || scopedToContentBearing(unit.node)
}

function scan(): Scan {
  const readers = new Map<string, Unit>()
  const byName = new Map<string, Unit[]>()
  const units: Unit[] = []
  for (const file of productionSources()) {
    const rel = srcKey(file)
    for (const unit of unitsOf(rel, parseSource(file))) {
      units.push(unit)
      const short = unit.name.split('.').pop() ?? unit.name
      byName.set(short, [...(byName.get(short) ?? []), unit])
      if (readsWords(unit)) readers.set(unit.key, unit)
    }
  }
  return { readers, byName, units }
}

function reachedFromPlatformAccess({ units, byName }: Scan): Set<string> {
  const reached = new Set<string>()
  const queue: string[] = []
  for (const unit of units) {
    walk(unit.node, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'withPlatformAccess'
      ) {
        for (const argument of node.arguments.slice(1)) queue.push(...identifiersOf(argument))
      }
    })
  }
  const seenNames = new Set<string>()
  while (queue.length > 0) {
    const name = queue.pop() as string
    if (seenNames.has(name)) continue
    seenNames.add(name)
    for (const unit of byName.get(name) ?? []) {
      if (reached.has(unit.key)) continue
      reached.add(unit.key)
      queue.push(...identifiersOf(unit.node))
    }
  }
  return reached
}

describe("every reader of a vote's words outside its tenant asks the rule (ADR-0093)", () => {
  const found = scan()
  const crossTenant = reachedFromPlatformAccess(found)

  it('finds every reader it knows, so a syntax check that stopped matching fails here', () => {
    expect([...found.readers.keys()].sort()).toEqual(
      expect.arrayContaining(Object.keys(READERS).sort())
    )
  })

  it('has every reader classified: a new one says whether it reads across tenants', () => {
    const unclassified = [...found.readers.keys()].filter((key) => !(key in READERS))
    expect(unclassified, 'classify each in READERS (restricted-readers-coverage.spec.ts)').toEqual([])
  })

  it('has every reader that applies the rule actually ask it', () => {
    const skipping = Object.entries(READERS)
      .filter(([, how]) => 'rule' in how)
      .map(([key]) => key)
      .filter((key) => {
        const unit = found.readers.get(key)
        return !unit || !asksRule(unit)
      })
    expect(skipping, 'call OUTSIDE_RESTRICTED_USE, or pass contentBearing: true to voteScope').toEqual([])
  })

  it('reaches no tenant-scoped reader from a platform callback', () => {
    const leaking = Object.entries(READERS)
      .filter(([key, how]) => 'tenant' in how && crossTenant.has(key))
      .map(([key]) => key)
    expect(leaking).toEqual([])
  })

  it('finds the cross-tenant readers it must (not vacuous)', () => {
    for (const key of [
      'lib/feedback/repository.ts::listFeedbackTurns',
      'lib/platform-lessons/repository.ts::listUnprocessedDownvotes',
    ]) {
      expect(crossTenant.has(key), key).toBe(true)
    }
  })
})

const mockGetDb = vi.mocked(getDb)

const ALL: FeedbackQuery = {
  scope: { from: '2026-09-10', to: '2026-10-09', organizationIds: [], projectIds: [] },
  ratings: NO_RATINGS_FILTERS,
}

const RULE_SQL = 'not feedback_restricted_use(f.organization_id, f.message_id, f.conversation_id)'

const renderSql = (fragment: SQL) => new PgDialect().sqlToQuery(fragment).sql

describe('the restricted-use rule, as the readers send it to the database', () => {
  it('is one database function call on the vote row', () => {
    expect(renderSql(OUTSIDE_RESTRICTED_USE)).toBe(RULE_SQL)
  })

  it('voteScope adds the rule only for content-bearing reads', () => {
    expect(renderSql(voteScope(ALL, { contentBearing: true }))).toContain(RULE_SQL)
    expect(renderSql(voteScope(ALL))).not.toContain(RULE_SQL)
  })

  it('isRestrictedUseVote asks the rule of the one vote it names', async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown[]>>().mockResolvedValue([])
    mockGetDb.mockReturnValue({ execute } as never)
    await isRestrictedUseVote('fb_1', 'org_1')
    expect(renderSql(execute.mock.calls[0]![0])).toContain(RULE_SQL)
  })
})
