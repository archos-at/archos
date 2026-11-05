/**
 * The geometry of a chart block, computed on the server: what `Chart.astro` draws, with no
 * script in the browser. Pure, so the tests hold the scales, ticks and labels.
 *
 * The plot is an SVG stretched to the width of its column (`preserveAspectRatio="none"`): a
 * fixed `PLOT_HEIGHT` in CSS pixels, so a vertical position is an exact pixel, and a width
 * of `PLOT_WIDTH` units that becomes whatever the column is. Strokes do not stretch
 * (`vector-effect: non-scaling-stroke`, as the blog covers' pens). Everything that is text
 * (ticks, labels, values, the legend) is HTML placed over the plot in percent and pixels, so
 * it stays at the type scale's size on a phone instead of shrinking with a drawing.
 *
 * The nice domain and the ticks are d3-array's (`nice`, `ticks`, `tickStep`): the one part
 * of a chart that is general and easy to get subtly wrong. The marks are ours.
 */
import { nice, tickStep, ticks } from 'd3-array';
import type { ChartBlock } from './contracts';

export type ChartLocale = 'de' | 'en';

/** The plot's height in CSS pixels, and the SVG's viewBox height: one unit is one pixel. */
export const PLOT_HEIGHT = 240;
/** The plot's width in viewBox units. It stretches to the column. */
export const PLOT_WIDTH = 1000;
/** The thickest bar, in units: about 24 px in the 680 px text column (dataviz mark spec). */
export const BAR_CAP = 36;
/** A line's first and last point sit this far in from the plot's edges, in units. */
const LINE_INSET = 24;
/** Labels within this many units (pixels at full height) of each other collide; the later series' label is dropped. */
const LABEL_CLEARANCE = 20;
/** Above this many labels on the horizontal axis, only every k-th is kept, counted back from the last. */
const MAX_MAJOR_LABELS = 6;

export interface Tick {
  value: number;
  /** From the plot's top, in px. */
  top: number;
  label: string;
  zero: boolean;
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  slot: number;
  title: string;
}

export interface Placed {
  /** Horizontal position in percent of the plot's width. */
  left: number;
  /** Vertical position in px from the plot's top. */
  top: number;
}

export interface ValueLabel extends Placed {
  text: string;
  /** Under the mark (a negative bar) instead of above it. */
  below: boolean;
  /** `center`: centred over the mark. `after`: to the right of a line's last point. */
  align: 'center' | 'after';
}

export interface AxisLabel {
  left: number;
  text: string;
  /** Left out where the labels would collide: a line's always, a bar chart's on a narrow column. */
  minor: boolean;
}

export interface ChartModel {
  form: ChartBlock['form'];
  stacked: boolean;
  ticks: Tick[];
  bars: Bar[];
  lines: { slot: number; path: string }[];
  dots: (Placed & { slot: number })[];
  values: ValueLabel[];
  xLabels: AxisLabel[];
  legend: { name: string; slot: number }[];
  table: { head: string[]; rows: { label: string; cells: string[] }[] };
  /** Many marks: value labels are dropped on a narrow column. */
  dense: boolean;
  /** Characters in the longest tick label, for the width of the tick column. */
  tickChars: number;
  /** Characters in the longest value at a line's end, for the gutter on the plot's right. */
  endChars: number;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_LOCALE: Record<ChartLocale, string> = { de: 'de-AT', en: 'en-GB' };

/** Decimal places written in `n` (0.25 → 2), ignoring floating-point noise. */
export function decimalsIn(n: number): number {
  const text = String(Number(n.toPrecision(12)));
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function formatNumber(n: number, decimals: number, locale: ChartLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

/** A value with its unit: „12,5 h“, „40 %“ in German, „40%“ in English. Non-breaking. */
export function formatValue(n: number, decimals: number, unit: string | undefined, locale: ChartLocale): string {
  const number = formatNumber(n, decimals, locale).replace('-', '−');
  if (!unit) return number;
  if (unit === '%' && locale === 'en') return `${number}%`;
  return `${number} ${unit}`;
}

/**
 * The value axis: a nice domain around `lo`–`hi` and about `count` ticks on it. The domain
 * always holds zero when `zero` is set, and never collapses to a point.
 */
export function valueScale(lo: number, hi: number, zero: boolean, count = 4) {
  let min = zero ? Math.min(0, lo) : lo;
  let max = zero ? Math.max(0, hi) : hi;
  if (min === max) {
    if (max === 0) max = 1;
    else if (max > 0) min = zero ? 0 : max * 0.5;
    else max = 0;
  }
  const [niceMin, niceMax] = nice(min, max, count);
  const values = ticks(niceMin, niceMax, count);
  const step = Math.abs(tickStep(niceMin, niceMax, count));
  const toTop = (v: number) => PLOT_HEIGHT - ((v - niceMin) / (niceMax - niceMin)) * PLOT_HEIGHT;
  return { min: niceMin, max: niceMax, values, decimals: decimalsIn(step), toTop };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const round = (n: number) => Math.round(n * 100) / 100;
const percent = (units: number) => round((units / PLOT_WIDTH) * 100);

/**
 * Which horizontal labels to leave out when there are too many: keep the last (the latest
 * week, the current state) and every k-th before it.
 */
export function minorLabels(n: number): boolean[] {
  if (n <= MAX_MAJOR_LABELS + 2) return Array(n).fill(false);
  const k = Math.ceil(n / MAX_MAJOR_LABELS);
  return Array.from({ length: n }, (_, i) => (n - 1 - i) % k !== 0);
}

/** Drops labels that collide with an earlier one (the earlier series wins). */
function withoutCollisions<T extends Placed>(labels: T[]): T[] {
  const kept: T[] = [];
  for (const label of labels) {
    if (kept.every((k) => Math.abs(k.top - label.top) >= LABEL_CLEARANCE)) kept.push(label);
  }
  return kept;
}

export function chartModel(chart: ChartBlock, locale: ChartLocale): ChartModel {
  const { labels, series, unit } = chart;
  const stacked = chart.form === 'bar' && chart.stacking === 'stacked' && series.length > 1;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const decimals = chart.decimals ?? Math.min(2, Math.max(0, ...all.map(decimalsIn)));
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const [lo, hi] = stacked ? [0, Math.max(...totals)] : [Math.min(...all), Math.max(...all)];
  const scale = valueScale(lo, hi, chart.form === 'bar' || chart.startAtZero !== false);
  const fmt = (v: number) => formatValue(v, decimals, unit, locale);

  const tickLabels = scale.values.map((v, i) => {
    const text = formatNumber(v, scale.decimals, locale).replace('-', '−');
    // The unit rides on the top tick only, as a reader reads the axis from there.
    return i === scale.values.length - 1 && unit && !chart.axisLabel ? formatValue(v, scale.decimals, unit, locale) : text;
  });
  const ticks: Tick[] = scale.values.map((value, i) => ({ value, top: round(scale.toTop(value)), label: tickLabels[i], zero: value === 0 }));
  const base = { form: chart.form, stacked, ticks, tickChars: Math.max(...tickLabels.map((t) => t.length)), endChars: 0 };
  const legend = series.length > 1 ? series.map((s, i) => ({ name: s.name, slot: i + 1 })) : [];
  const table = {
    head: series.map((s) => s.name),
    rows: labels.map((label, i) => ({ label, cells: series.map((s) => (s.values[i] === null ? '–' : fmt(s.values[i] as number))) })),
  };
  const minor = minorLabels(labels.length);

  if (chart.form === 'line') {
    const step = (PLOT_WIDTH - 2 * LINE_INSET) / (labels.length - 1);
    const xOf = (i: number) => LINE_INSET + i * step;
    const lines = series.map((s, si) => {
      let path = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v === null) return void (pen = false);
        path += `${pen ? 'L' : 'M'}${round(xOf(i))} ${round(scale.toTop(v))}`;
        pen = true;
      });
      return { slot: si + 1, path };
    });
    const showPoints = labels.length <= 8;
    const dots = series.flatMap((s, si) =>
      s.values.flatMap((v, i) => {
        const last = s.values.findLastIndex((x) => x !== null);
        return v !== null && (showPoints || i === last) ? [{ left: percent(xOf(i)), top: round(scale.toTop(v)), slot: si + 1 }] : [];
      }),
    );
    const ends = series.flatMap((s) => {
      const i = s.values.findLastIndex((x) => x !== null);
      const v = s.values[i] as number;
      return i < 0 ? [] : [{ left: percent(xOf(i)), top: round(scale.toTop(v)), text: fmt(v), below: false, align: 'after' as const }];
    });
    const values = withoutCollisions(ends);
    const xLabels: AxisLabel[] = labels.map((text, i) => ({ left: percent(xOf(i)), text, minor: minor[i] }));
    const endChars = Math.max(0, ...values.map((v) => v.text.length));
    return { ...base, endChars, bars: [], lines, dots, values, xLabels, legend, table, dense: false };
  }

  const band = PLOT_WIDTH / labels.length;
  const grouped = !stacked && series.length > 1;
  const groupWidth = grouped ? Math.min(band * 0.64, series.length * BAR_CAP) : Math.min(band * 0.56, BAR_CAP);
  const bars: Bar[] = [];
  labels.forEach((label, i) => {
    const center = (i + 0.5) * band;
    let floor = 0;
    series.forEach((s, si) => {
      const v = s.values[i];
      if (v === null || v === 0) return;
      const title = `${label}${series.length > 1 ? ` · ${s.name}` : ''}: ${fmt(v)}`;
      const w = grouped ? groupWidth / series.length : groupWidth;
      const x = grouped ? center - groupWidth / 2 + si * w : center - w / 2;
      const [from, to] = stacked ? [floor, floor + v] : [0, v];
      floor += stacked ? v : 0;
      const [top, bottom] = [scale.toTop(Math.max(from, to)), scale.toTop(Math.min(from, to))];
      bars.push({ x: round(x), y: round(top), w: round(w), h: round(bottom - top), slot: si + 1, title });
    });
  });
  // A value at each bar's end, or each stack's total: never one per segment or per grouped bar.
  const values: ValueLabel[] = grouped
    ? []
    : labels.flatMap((_, i) => {
        const v = stacked ? totals[i] : series[0].values[i];
        if (v === null) return [];
        return [{ left: percent((i + 0.5) * band), top: round(scale.toTop(v)), text: fmt(v), below: v < 0, align: 'center' as const }];
      });
  const xLabels: AxisLabel[] = labels.map((text, i) => ({ left: percent((i + 0.5) * band), text, minor: minor[i] }));
  return { ...base, bars, lines: [], dots: [], values, xLabels, legend, table, dense: labels.length > 6 };
}
