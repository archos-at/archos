/**
 * The chart's geometry: the value scale and its ticks, the number format of both languages,
 * the marks, and the labels a narrow column cannot hold.
 */
import { describe, expect, test } from 'bun:test';
import { BAR_CAP, PLOT_HEIGHT, PLOT_WIDTH, chartModel, decimalsIn, formatValue, minorLabels, valueScale } from './chart-model';
import type { ChartBlock } from './contracts';

const bar = (over: Partial<ChartBlock> = {}): ChartBlock => ({
  form: 'bar',
  title: 'Mit jedem Planstand ändern sich weniger Räume.',
  labels: ['Rev. A', 'Rev. B', 'Rev. C'],
  series: [{ name: 'Räume', values: [14, 9, 6] }],
  source: 'Beispielwerte',
  ...over,
});

describe('valueScale', () => {
  test('rounds the domain out to nice ticks and starts bars at zero', () => {
    const scale = valueScale(6, 14, true);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(15);
    expect(scale.values).toEqual([0, 5, 10, 15]);
    expect(scale.toTop(0)).toBe(PLOT_HEIGHT);
    expect(scale.toTop(15)).toBe(0);
  });

  test('a line may leave zero out', () => {
    const scale = valueScale(41, 58, false);
    expect(scale.min).toBeGreaterThan(0);
    expect(scale.values[0]).toBeGreaterThanOrEqual(scale.min);
    expect(scale.max).toBeGreaterThanOrEqual(58);
  });

  test('takes negative values and keeps zero inside', () => {
    const scale = valueScale(-3, 8, true);
    expect(scale.min).toBeLessThanOrEqual(-3);
    expect(scale.values).toContain(0);
  });

  test('never collapses to a point', () => {
    expect(valueScale(0, 0, true).max).toBe(1);
    expect(valueScale(5, 5, true).max).toBeGreaterThanOrEqual(5);
    expect(valueScale(5, 5, true).min).toBe(0);
  });

  test('gives ticks the decimals of their step', () => {
    expect(valueScale(0, 1.2, true).decimals).toBe(1);
    expect(valueScale(0, 120, true).decimals).toBe(0);
  });
});

describe('numbers', () => {
  test('decimalsIn ignores floating-point noise', () => {
    expect(decimalsIn(0.25)).toBe(2);
    expect(decimalsIn(0.1 + 0.2)).toBe(1);
    expect(decimalsIn(12)).toBe(0);
    expect(decimalsIn(1e-7)).toBe(7);
  });

  test('writes values in the reader’s language, unit attached without a break', () => {
    expect(formatValue(12.5, 1, 'h', 'de')).toBe('12,5 h');
    expect(formatValue(12.5, 1, 'h', 'en')).toBe('12.5 h');
    expect(formatValue(40, 0, '%', 'de')).toBe('40 %');
    expect(formatValue(40, 0, '%', 'en')).toBe('40%');
    expect(formatValue(1200, 0, undefined, 'de')).toBe('1 200');
    expect(formatValue(-3, 0, undefined, 'en')).toBe('−3');
  });
});

describe('minorLabels', () => {
  test('keeps every label while they fit', () => {
    expect(minorLabels(8)).toEqual(Array(8).fill(false));
  });

  test('keeps the last label and every k-th before it', () => {
    const minor = minorLabels(12);
    expect(minor.at(-1)).toBe(false);
    expect(minor.filter((m) => !m)).toHaveLength(6);
    expect(minor[0]).toBe(true);
  });
});

describe('chartModel', () => {
  test('a single series: bars no thicker than the cap, a value at each end, no legend', () => {
    const model = chartModel(bar(), 'de');
    expect(model.bars).toHaveLength(3);
    for (const b of model.bars) expect(b.w).toBeLessThanOrEqual(BAR_CAP);
    expect(model.bars[0].y + model.bars[0].h).toBe(PLOT_HEIGHT);
    expect(model.values.map((v) => v.text)).toEqual(['14', '9', '6']);
    expect(model.legend).toEqual([]);
    expect(model.grid.at(-1)?.label).toBe('15');
  });

  test('the unit rides on the top tick unless the axis has a label', () => {
    expect(chartModel(bar({ unit: 'h' }), 'de').grid.at(-1)?.label).toBe('15 h');
    expect(chartModel(bar({ unit: 'h', axisLabel: 'Stunden' }), 'de').grid.at(-1)?.label).toBe('15');
  });

  test('grouped bars sit side by side in their band, without value labels', () => {
    const model = chartModel(bar({ series: [{ name: 'A', values: [4, 6, 3] }, { name: 'B', values: [3, 5, 4] }] }), 'en');
    expect(model.bars).toHaveLength(6);
    const [a, b] = model.bars;
    expect(b.x).toBeCloseTo(a.x + a.w, 1);
    expect(a.x + a.w + b.w).toBeLessThanOrEqual(PLOT_WIDTH / 3);
    expect(model.values).toEqual([]);
    expect(model.legend.map((l) => l.slot)).toEqual([1, 2]);
  });

  test('stacked bars rest on each other and carry their total', () => {
    const model = chartModel(
      bar({ stacking: 'stacked', series: [{ name: 'A', values: [5, 7, 4] }, { name: 'B', values: [2, 0, 2] }] }),
      'de',
    );
    const first = model.bars.filter((b) => b.x === model.bars[0].x);
    expect(first).toHaveLength(2);
    expect(first[1].y + first[1].h).toBeCloseTo(first[0].y, 5);
    expect(model.values.map((v) => v.text)).toEqual(['7', '7', '6']);
    expect(model.bars.some((b) => b.h === 0)).toBe(false);
  });

  test('a negative bar hangs from zero and its value sits below it', () => {
    const model = chartModel(bar({ series: [{ name: 'Δ', values: [3, -2, 1] }] }), 'de');
    const zero = model.grid.find((t) => t.zero)!;
    expect(model.bars[1].y).toBeCloseTo(zero.top, 5);
    expect(model.values[1].below).toBe(true);
    expect(model.values[1].text).toBe('−2');
  });

  test('a line breaks at a missing value and labels its last point', () => {
    const model = chartModel(
      { ...bar(), form: 'line', labels: ['KW 1', 'KW 2', 'KW 3', 'KW 4'], series: [{ name: 'Offen', values: [8, null, 5, 3] }] },
      'de',
    );
    expect(model.lines[0].path.match(/M/g)).toHaveLength(2);
    expect(model.values).toHaveLength(1);
    expect(model.values[0]).toMatchObject({ text: '3', align: 'after' });
    expect(model.endChars).toBe(1);
    expect(model.dots).toHaveLength(3);
  });

  test('end labels that would collide keep the first series’ only', () => {
    const model = chartModel(
      { ...bar(), form: 'line', series: [{ name: 'A', values: [10, 12, 14] }, { name: 'B', values: [9, 11, 13.8] }] },
      'en',
    );
    expect(model.values.map((v) => v.text)).toEqual(['14.0']);
  });

  test('the table holds every value, a missing one as a dash', () => {
    const model = chartModel(bar({ unit: 'h', series: [{ name: 'Zeit', values: [1.5, null, 2] }] }), 'de');
    expect(model.table.head).toEqual(['Zeit']);
    expect(model.table.rows.map((r) => r.cells[0])).toEqual(['1,5 h', '–', '2,0 h']);
  });
});
