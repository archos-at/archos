import { nice, tickStep, ticks } from 'd3-array';
import type { ChartBlock } from './contracts';

export type ChartLocale = 'de' | 'en';

export const PLOT_HEIGHT = 240;
export const PLOT_WIDTH = 1000;
export const BAR_CAP = 36;
const LINE_INSET = 24;
const LABEL_CLEARANCE = 20;
const MAX_MAJOR_LABELS = 6;

export interface Tick {
  value: number;
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
  left: number;
  top: number;
}

export interface ValueLabel extends Placed {
  text: string;
  below: boolean;
  align: 'center' | 'after';
}

export interface AxisLabel {
  left: number;
  text: string;
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
  dense: boolean;
  tickChars: number;
  endChars: number;
}

const NUMBER_LOCALE: Record<ChartLocale, string> = { de: 'de-AT', en: 'en-GB' };

export function decimalsIn(n: number): number {
  const text = String(Number(n.toPrecision(12)));
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function formatNumber(n: number, decimals: number, locale: ChartLocale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export function formatValue(n: number, decimals: number, unit: string | undefined, locale: ChartLocale): string {
  const number = formatNumber(n, decimals, locale).replace('-', '−');
  if (!unit) return number;
  if (unit === '%' && locale === 'en') return `${number}%`;
  return `${number} ${unit}`;
}

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

const round = (n: number) => Math.round(n * 100) / 100;
const percent = (units: number) => round((units / PLOT_WIDTH) * 100);

export function minorLabels(n: number): boolean[] {
  if (n <= MAX_MAJOR_LABELS + 2) return Array(n).fill(false);
  const k = Math.ceil(n / MAX_MAJOR_LABELS);
  return Array.from({ length: n }, (_, i) => (n - 1 - i) % k !== 0);
}

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
    return i === scale.values.length - 1 && unit && !chart.axisLabel ? formatValue(v, scale.decimals, unit, locale) : text;
  });
  const axis: Tick[] = scale.values.map((value, i) => ({ value, top: round(scale.toTop(value)), label: tickLabels[i], zero: value === 0 }));
  const base = { form: chart.form, stacked, ticks: axis, tickChars: Math.max(...tickLabels.map((t) => t.length)), endChars: 0 };
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
