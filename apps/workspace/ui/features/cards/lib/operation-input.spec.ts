/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { humanizeKey, operationInputRows } from './operation-input'

describe('humanizeKey', () => {
  it.each([
    ['folderId', 'Folder ID'],
    ['id', 'ID'],
    ['memoryScope', 'Memory scope'],
    ['target_folder', 'Target folder'],
    ['if-match', 'If match'],
    ['name', 'Name'],
    ['', ''],
  ])('%s reads as "%s"', (key, words) => {
    expect(humanizeKey(key)).toBe(words)
  })
})

describe('a short nested value', () => {
  it('is written on one line and shown whole, so nothing of it waits to be unfolded', () => {
    const [region, list] = operationInputRows(
      { body: { region: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, tags: ['a'.repeat(90)] } },
      () => undefined
    )
    expect(region).toMatchObject({ value: '{"x": 0.2, "y": 0.3, "w": 0.4, "h": 0.2}', long: false })
    expect(list.long).toBe(true)
  })
})
