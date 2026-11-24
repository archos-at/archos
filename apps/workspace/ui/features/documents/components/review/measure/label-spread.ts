export type LabelBox = { x: number; y: number; text: string }

const CHAR_PX = 7
const PAD_PX = 14
const HEIGHT_PX = 22
const TRIES = [0, -1, 1, -2, 2, -3, 3]

const widthOf = (text: string): number => text.length * CHAR_PX + PAD_PX

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  Math.abs(a.x - b.x) * 2 < widthOf(a.text) + widthOf(b.text) && Math.abs(a.y - b.y) < HEIGHT_PX

export function spreadLabels(fixed: readonly LabelBox[], labels: readonly LabelBox[]): LabelBox[] {
  const placed = [...fixed]
  return labels.map((label) => {
    const free =
      TRIES.map((step) => ({ ...label, y: label.y + step * HEIGHT_PX })).find((candidate) =>
        placed.every((other) => !overlaps(candidate, other))
      ) ?? label
    placed.push(free)
    return free
  })
}
