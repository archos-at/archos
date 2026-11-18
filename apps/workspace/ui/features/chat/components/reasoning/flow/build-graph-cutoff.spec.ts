import { describe, test, expect } from 'vitest'
import { buildGraph } from './build-graph'
import { planFan } from './flow-layout'
import type { ReasoningFlowProps } from './reasoning-flow-props'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { createTranslator, getByPath } from '@/i18n/translate'
import type { Translator } from '@/i18n'
import { DESKTOP_W, base, de, en, t, technicalStep } from './reasoning-flow.fixtures'

describe('a turn that was CUT OFF says so where the fan converges', () => {
  const budgetStep = (tools: string[]) => technicalStep('budget', { truncated: true, tools })

  const findings = (g: ReturnType<typeof buildGraph>) =>
    g.nodes.find((n) => n.id === 'findings')?.data as
      | { truncation?: { before: string; step?: string; after: string; mono: boolean } }
      | undefined

  test('a truncated turn with nothing found still gets an assessment node', () => {
    const props: ReasoningFlowProps = { ...base, steps: [budgetStep(['knowledge_search'])] }
    const g = buildGraph(props, t, planFan(DESKTOP_W, 0), [])
    expect(g.nodes.find((n) => n.id === 'findings')).toBeDefined()
    expect(findings(g)?.truncation?.step).toBe('thinking.stepName.corpus')
  })

  test('a tool with no reader-facing name is shown as the identifier it is', () => {
    const props: ReasoningFlowProps = {
      ...base,
      steps: [budgetStep(['use_skill', 'find_elements', 'light_incidence'])],
    }
    const g = buildGraph(props, t, planFan(DESKTOP_W, 0), [])
    expect(findings(g)?.truncation).toMatchObject({ step: 'light_incidence', mono: true })
  })

  test('truncated with no tool named falls back to saying less', () => {
    const props: ReasoningFlowProps = { ...base, steps: [budgetStep([])] }
    const g = buildGraph(props, t, planFan(DESKTOP_W, 0), [])
    expect(findings(g)?.truncation).toEqual({
      before: 'thinking.node.findingsTruncated',
      after: '',
      mono: false,
    })
  })

  test('a turn that finished its research carries no truncation line', () => {
    const props: ReasoningFlowProps = { ...base, answerConfidence: 'high' }
    const g = buildGraph(props, t, planFan(DESKTOP_W, 0), [])
    expect(findings(g)?.truncation).toBeUndefined()
  })

  test('while the turn is still live the graph claims nothing about the ending', () => {
    const props: ReasoningFlowProps = { ...base, steps: [budgetStep(['knowledge_search'])], live: true }
    const g = buildGraph(props, t, planFan(DESKTOP_W, 0), [])
    expect(findings(g)?.truncation).toBeUndefined()
  })
})

describe('a deep run that was cut off or degraded says so under the assessment', () => {
  const cutoffStep = (payload: Record<string, unknown>) =>
    technicalStep('budget:deep', { truncated: true, agent: 'deep', ...payload })
  const degradedStep = (reasons: string[]) =>
    technicalStep('degraded', { degraded: true, agent: 'deep', reasons })

  const limits = (g: ReturnType<typeof buildGraph>) =>
    (g.nodes.find((n) => n.id === 'findings')?.data as
      | { limits?: { label: string; lines: Array<{ text: string; warn: boolean }> } }
      | undefined)?.limits

  const build = (steps: StoredThinkingStep[], translator: Translator = t) =>
    buildGraph({ ...base, steps }, translator, planFan(DESKTOP_W, 0), [])

  test('a cut-off turn with no verdict and no sources still gets an assessment node', () => {
    const g = build([cutoffStep({ reason: 'wall_clock', salvaged: false, source_count: 0, report_chars: 0 })])
    expect(g.nodes.find((n) => n.id === 'findings')).toBeDefined()
    expect(limits(g)?.lines[0]).toEqual({
      text: 'thinking.node.limits.deepCutoff.time thinking.node.limits.deepCutoff.nothing',
      warn: false,
    })
  })

  test('the cause and its consequence are one statement; what was gathered is the next', () => {
    const g = build([
      cutoffStep({ reason: 'step_limit', salvaged: true, source_count: 12, report_chars: 4210, elapsed_seconds: 486 }),
    ])
    expect(limits(g)?.lines.map((l) => l.text)).toEqual([
      'thinking.node.limits.deepCutoff.steps thinking.node.limits.deepCutoff.salvaged',
      'thinking.node.limits.deepCutoff.sources thinking.node.limits.deepCutoff.after',
    ])
  })

  test('nothing worth counting is left unsaid rather than counted to zero', () => {
    const g = build([cutoffStep({ reason: 'wall_clock', salvaged: false, source_count: 0, elapsed_seconds: 41 })])
    expect(limits(g)?.lines).toHaveLength(1)
  })

  test('an unknown cutoff reason still earns the shorter true sentence', () => {
    const g = build([cutoffStep({ reason: 'quota_exhausted', salvaged: true })])
    expect(limits(g)?.lines[0]?.text).toContain('thinking.node.limits.deepCutoff.other')
  })

  test('a degraded answer is marked as one the reader should check', () => {
    const g = build([
      degradedStep(['no_report_file', 'no_valid_citations', 'cards_generation_failed', 'basis_unread']),
    ])
    expect(limits(g)?.lines).toEqual([
      { text: 'thinking.node.limits.degraded.noReport', warn: true },
      { text: 'thinking.node.limits.degraded.noCitations', warn: true },
      { text: 'thinking.node.limits.degraded.noCards', warn: true },
      { text: 'thinking.node.limits.degraded.basisUnread', warn: true },
    ])
  })

  test('cut off AND degraded reads as one block, cause first', () => {
    const g = build([
      cutoffStep({ reason: 'wall_clock', salvaged: true, source_count: 3 }),
      degradedStep(['no_valid_citations']),
    ])
    expect(limits(g)?.lines.map((l) => l.warn)).toEqual([false, false, true])
  })

  test('a clean turn carries no limits block — there is no "all clear" row', () => {
    const g = buildGraph({ ...base, answerConfidence: 'high' }, t, planFan(DESKTOP_W, 0), [])
    expect(limits(g)).toBeUndefined()
  })

  test('while the turn is still live the graph claims nothing about the answer', () => {
    const g = buildGraph(
      { ...base, steps: [degradedStep(['no_valid_citations'])], live: true },
      t,
      planFan(DESKTOP_W, 0),
      []
    )
    expect(limits(g)).toBeUndefined()
  })

  test.each(['de', 'en'])('%s says all of it in words, never a dictionary path', (locale) => {
    const translator = createTranslator(locale === 'de' ? de : en, 'chat') as Translator
    const shapes = [
      [cutoffStep({ reason: 'wall_clock', salvaged: true, source_count: 1, elapsed_seconds: 62 })],
      [cutoffStep({ reason: 'step_limit', salvaged: false, source_count: 9, elapsed_seconds: 900 })],
      [cutoffStep({ reason: 'quota_exhausted', salvaged: false })],
      [degradedStep(['no_report_file', 'no_valid_citations', 'cards_generation_failed'])],
    ]
    for (const steps of shapes) {
      const block = limits(build(steps, translator))
      expect(block).toBeDefined()
      expect(block!.label).not.toContain('thinking.')
      for (const line of block!.lines) {
        expect(line.text).not.toContain('thinking.')
        expect(line.text).not.toContain('{')
        expect(line.text.trim().length).toBeGreaterThan(0)
      }
    }
  })

  test('the singular and the plural are both spelled, in both locales', () => {
    for (const dictionary of [de, en]) {
      const translator = createTranslator(dictionary, 'chat') as Translator
      const line = (count: number) =>
        limits(build([cutoffStep({ reason: 'wall_clock', salvaged: true, source_count: count })], translator))!
          .lines[1]!.text
      expect(line(1)).not.toEqual(line(4))
      expect(line(1)).toContain('1')
      expect(line(4)).toContain('4')
    }
  })

  test.each(['de', 'en'])('%s has a string for every limits key the node can ask for', (locale) => {
    const dictionary = locale === 'de' ? de : en
    const keys = [
      'label',
      ...['time', 'steps', 'other', 'salvaged', 'nothing', 'sources', 'after'].map(
        (k) => `deepCutoff.${k}`
      ),
      ...['noReport', 'noCitations'].map((k) => `degraded.${k}`),
    ]
    const missing = keys.filter(
      (key) => typeof getByPath(dictionary, `chat.thinking.node.limits.${key}`) !== 'string'
    )
    expect(missing).toEqual([])
  })
})
