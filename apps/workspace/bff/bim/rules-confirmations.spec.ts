import { describe, expect, it } from 'vitest'
import { attachConfirmations, outstandingRules } from './rules'
import { runBimRules, element, STOREYS } from './rules.fixtures'

describe('human confirmations', () => {
  const failing = runBimRules(
    [
      element({
        ifcType: 'IfcDoor',
        name: 'T-14',
        quantities: { Qto_DoorBaseQuantities: { Width: 0.7 } },
      }),
    ],
    {}
  )
  const confirmation = {
    ruleId: 'oib4-door-clear-width',
    modelId: 'rev-3',
    confirmedBy: 'a.muster',
    note: 'Nebenraum, keine Aufenthaltsnutzung — mit der MA 37 abgeklärt.',
    confirmedAt: '2026-03-02T09:00:00.000Z',
  }

  it('sits beside the machine verdict rather than overwriting it', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'rev-3').filter(
      (entry) => entry.ruleId === 'oib4-door-clear-width'
    )
    expect(rule.failed).toBe(1)
    expect(rule.confirmation?.confirmedBy).toBe('a.muster')
    expect(rule.confirmationStale).toBe(false)
  })

  it('shows no confirmation on a rule that now only gives a hint, and keeps it for when it judges again', () => {
    const hinted = failing.map((entry) => (entry.ruleId === 'oib4-door-clear-width' ? { ...entry, hint: 'Hinweis: Grundlage am Standort nicht bestimmt' } : entry))
    const [hint] = attachConfirmations(hinted, [confirmation], 'rev-3').filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(hint.confirmation).toBeNull()
    expect(hint.confirmationStale).toBe(false)
    const [judged] = attachConfirmations(failing, [confirmation], 'rev-3').filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(judged.confirmation?.confirmedBy).toBe('a.muster')
  })

  it('marks a confirmation made against another revision as stale', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'rev-4', ['rev-3', 'rev-4']).filter(
      (entry) => entry.ruleId === 'oib4-door-clear-width'
    )
    expect(rule.confirmation).not.toBeNull()
    expect(rule.confirmationStale).toBe(true)
  })

  it('does not show one building’s confirmation on another building’s Prüfbuch', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'nebengebaeude-1', [
      'nebengebaeude-1',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation).toBeNull()
    expect(rule.confirmationStale).toBe(false)
  })

  it('prefers the current revision’s confirmation over an older one', () => {
    const older = { ...confirmation, modelId: 'rev-3', confirmedBy: 'a.muster' }
    const current = { ...confirmation, modelId: 'rev-4', confirmedBy: 'b.beispiel' }
    const [rule] = attachConfirmations(failing, [older, current], 'rev-4', [
      'rev-3',
      'rev-4',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation?.confirmedBy).toBe('b.beispiel')
    expect(rule.confirmationStale).toBe(false)
  })

  it('shows the most recent older confirmation when the current revision has none', () => {
    const first = { ...confirmation, modelId: 'rev-2', confirmedAt: '2026-01-01T00:00:00.000Z' }
    const second = { ...confirmation, modelId: 'rev-3', confirmedAt: '2026-03-02T09:00:00.000Z' }
    const [rule] = attachConfirmations(failing, [first, second], 'rev-4', [
      'rev-2',
      'rev-3',
      'rev-4',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation?.modelId).toBe('rev-3')
    expect(rule.confirmationStale).toBe(true)
  })

  it('leaves a rule with no confirmation alone', () => {
    const rules = attachConfirmations(failing, [], 'rev-3')
    expect(rules.every((rule) => rule.confirmation === null)).toBe(true)
    expect(rules.every((rule) => rule.confirmationStale === false)).toBe(true)
  })
})

describe('outstandingRules', () => {
  const run = runBimRules(
    [
      element({ ifcType: 'IfcDoor', name: 'narrow', quantities: { Qto_DoorBaseQuantities: { Width: 0.7 } } }),
      element({ ifcType: 'IfcWall', name: 'W1', properties: { Pset_WallCommon: { LoadBearing: true } } }),
    ],
    { buildingClass: 3, storeys: STOREYS }
  )
  const cover = (ruleId: string, modelId: string) => ({
    ruleId,
    modelId,
    confirmedBy: 'a.muster',
    note: null,
    confirmedAt: '2026-03-02T09:00:00.000Z',
  })

  it('lists what still needs a human', () => {
    const outstanding = outstandingRules(attachConfirmations(run, [], 'rev-3'))
    const ids = outstanding.map((rule) => rule.ruleId)
    expect(ids).toContain('oib4-door-clear-width')
    expect(ids).toContain('oib2-fire-resistance-load-bearing')
  })

  it('drops a rule a current confirmation covers', () => {
    const outstanding = outstandingRules(
      attachConfirmations(run, [cover('oib4-door-clear-width', 'rev-3')], 'rev-3')
    )
    expect(outstanding.map((rule) => rule.ruleId)).not.toContain('oib4-door-clear-width')
  })

  it('does NOT let a stale confirmation close a rule', () => {
    const outstanding = outstandingRules(
      attachConfirmations(run, [cover('oib4-door-clear-width', 'rev-2')], 'rev-3')
    )
    expect(outstanding.map((rule) => rule.ruleId)).toContain('oib4-door-clear-width')
  })

  it('never lists a rule that passed or stood down', () => {
    const outstanding = outstandingRules(attachConfirmations(run, [], 'rev-3'))
    expect(outstanding.length).toBeGreaterThan(0)
    for (const rule of outstanding) {
      expect(rule.applicable).toBe(true)
      expect(rule.failed + rule.undecidable).toBeGreaterThan(0)
    }
  })
})
