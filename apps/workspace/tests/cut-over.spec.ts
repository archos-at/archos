/**
 * @vitest-environment node
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

const REMOVED: Record<string, string> = {
  'bff/oib': 'the law at the site from the records, `bff/base-knowledge/context/project-law.ts`',
  'bff/base-knowledge/platform/applicability.ts': 'the competence rulesets, `directiveVerdict` in `bff/base-knowledge/platform.ts`',
  'ui/features/projects/components/applicable-standards.tsx': 'the Steckbrief card, `ui/features/project-intake/components/profile/rules-card.tsx`',
  'ui/features/projects/components/standard-chips.tsx': 'the role dots of the Steckbrief card',
  'app/api/projects/[id]/standards': '`project-base-get`, whose `law` names the editions',
}

const OLD_NAMES = ['getApplicableStandards', 'deriveProjectStandards', 'OIB_STANDARDS', 'platformDirectiveApplies', 'project-standards-get', 'AUSTRIAN_STATES']

const LAND_LISTS = [/'lower_austria',\s*'upper_austria'/, /lower_austria: 'AT-3'/, /'AT-3': 'Nieder/]

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(ROOT, dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(relative(ROOT, path))
    return /\.tsx?$/.test(name) && !name.includes('.spec.') && !name.includes('.test.') ? [relative(ROOT, path)] : []
  })
}

describe('the cut-over (ADR-0175)', () => {
  it.each(Object.entries(REMOVED))('%s stays removed: %s replaced it', (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false)
  })

  it('no source reads a name of the old paths', () => {
    const found = ['bff', 'ui', 'app'].flatMap(sources).flatMap((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8')
      return OLD_NAMES.filter((name) => text.includes(name)).map((name) => `${file}: ${name}`)
    })
    expect(found).toEqual([])
  })

  it('no source writes its own list of Austria’s Länder', () => {
    const found = ['bff', 'ui', 'app'].flatMap(sources).filter((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8')
      return LAND_LISTS.some((pattern) => pattern.test(text))
    })
    expect(found.filter((file) => !file.endsWith('.fixtures.ts') && !file.startsWith('app/dev/'))).toEqual([])
  })
})
