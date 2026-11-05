/**
 * The data contracts of the post blocks in this folder: what each component takes, as plain,
 * serializable JSON, and the one parser per block that turns untrusted JSON (a CMS block's
 * fields) into it. The CMS registers one block per entry of `BLOCK_PARSERS`, with fields that
 * produce the shape below; the site's mapper calls the parser and drops a block that does not
 * parse, as it drops an unknown block kind. README.md in this folder is the same contract in
 * prose, with an example payload per block.
 *
 * Pure and import-free on purpose: the tests, the components and a CMS mapper read it alike.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * The coarse kinds a source can be: the keys of `SOURCE_KINDS` in
 * `packages/agent/src/agent/common/source_kinds.py`. The website cannot import the
 * workspace's generated copy (its image sees only apps/website), so this is a mirror that
 * `contracts.test.ts` holds to `apps/workspace/shared/vocabularies.generated.ts`.
 */
export const SOURCE_KINDS = ['building_law', 'office', 'project', 'web', 'measurement'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * An image a block shows, already resolved to a URL. The CMS holds an upload; the mapper
 * turns it into `src` (and `srcset`) through the CMS's transform presets, as PostBlocks does
 * for an image block.
 */
export interface BlockImage {
  src: string;
  /** Intrinsic size of `src`, for the aspect ratio and against layout shift. */
  width: number;
  height: number;
  /** What the image shows, for a reader who cannot see it. Required. */
  alt: string;
  srcset?: string;
  sizes?: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string[] };

// ---------------------------------------------------------------------------
// The contracts
// ---------------------------------------------------------------------------

export interface ChartSeries {
  name: string;
  /** One value per label; `null` is a missing value (no bar, a gap in the line). */
  values: (number | null)[];
}

export interface ChartBlock {
  /** `bar`: vertical bars from a zero baseline. `line`: change over an ordered axis. */
  form: 'bar' | 'line';
  /** Bars only, with two or three series: side by side (default) or on top of each other. */
  stacking?: 'grouped' | 'stacked';
  /** The finding, as a statement: „Die Antwortzeit sank um ein Drittel.“ */
  title: string;
  /** One sentence under the title: what is measured, where, when. */
  caption?: string;
  /** Short unit written after a value: `%`, `h`, `m²`, `Tage`. */
  unit?: string;
  /** What the vertical axis measures, when the title does not say it: „Stunden je Planstand“. */
  axisLabel?: string;
  /** Decimal places of the values (0–2). Without it, as many as the data has, at most 2. */
  decimals?: number;
  /** Lines only: start the axis at zero (default true). Bars always start at zero. */
  startAtZero?: boolean;
  /** The categories or points along the horizontal axis, 2 to 24. */
  labels: string[];
  /** One to three series. */
  series: ChartSeries[];
  /** Where the numbers come from (Belegpflicht): „Pilotbetrieb in drei Büros, Sept. 2026“. */
  source: string;
  sourceUrl?: string;
}

export interface KeyFigure {
  /** The number as it is read, already formatted: „3,5“, „1.284“, „11“. */
  value: string;
  /** Short unit after the value: `h`, `%`, `Tage`. */
  unit?: string;
  /** What the number counts, one line: „Stunden bis zur Antwort“. */
  label: string;
  /** Where the number comes from; shown as a numbered note under the row. */
  source?: string;
}

export interface KeyFiguresBlock {
  /** Two to four figures. */
  items: KeyFigure[];
}

export interface CompareBlock {
  /** The earlier state, on the left. */
  before: BlockImage;
  /** The later state, on the right. Same aspect ratio as `before`. */
  after: BlockImage;
  /** Short names of the two states: „Rev. C, 12.09.“, „Rev. D, 25.09.“ */
  beforeLabel: string;
  afterLabel: string;
  caption?: string;
  /** Where the divider starts, in percent from the left (default 50). */
  start?: number;
}

export interface ImageMarker {
  /** Position in percent of the image's width and height, from its top left corner. */
  x: number;
  y: number;
  /** What the marker points at, one line. */
  title: string;
  /** The explanation, one or two sentences. */
  text?: string;
}

export interface AnnotatedImageBlock {
  image: BlockImage;
  /** One to nine markers, numbered in this order. */
  markers: ImageMarker[];
  caption?: string;
}

export interface LegalSourceBlock {
  /** The norm or law: „OIB-Richtlinie 2.2“, „Wiener Bauordnung“. */
  title: string;
  /** The passage: „Punkt 5.1.1“, „§ 106 Abs. 2“. */
  section?: string;
  /** The edition or the version's date: „Ausgabe Mai 2023“, „Fassung vom 01.01.2025“. */
  version?: string;
  /** Who issues it: „Österreichisches Institut für Bautechnik“. */
  issuer?: string;
  /** The passage's wording, short and verbatim. */
  excerpt?: string;
  /** The source itself (RIS, OIB), https only. */
  url?: string;
}

export interface QaSource {
  kind: SourceKind;
  /** The document: „OIB-Richtlinie 2.3“, „Brandschutzkonzept, Rev. B“. */
  title: string;
  /** Where in it: „Punkt 3.2“, „S. 4“. */
  detail?: string;
}

export interface QaExcerptBlock {
  question: string;
  /** The answer as Markdown (paragraphs, bold, lists); raw HTML is escaped. */
  answer: string;
  /** Up to six sources, shown in this order. */
  sources: QaSource[];
  /** How many sources the answer was derived from, when more than the ones shown. */
  sourceCount?: number;
  /** Who asked, without a name: „Projektleiterin, Wohnbau in Wien“. */
  asker?: string;
  caption?: string;
}

export interface KeyTakeawaysBlock {
  /** Overrides the default heading („Das Wichtigste in Kürze“ / „Key takeaways“). */
  title?: string;
  /** Three to five short sentences. */
  items: string[];
}

// ---------------------------------------------------------------------------
// Reading untrusted JSON
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** Collects the problems of one block while its fields are read. */
class Reader {
  issues: string[] = [];
  constructor(readonly at: string) {}

  fail(message: string): undefined {
    this.issues.push(`${this.at}: ${message}`);
    return undefined;
  }

  text(obj: Json, key: string, max: number, required: true): string;
  text(obj: Json, key: string, max: number, required?: false): string | undefined;
  text(obj: Json, key: string, max: number, required = false): string | undefined {
    const value = obj[key];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return required ? (this.fail(`${key} is required`), '') : undefined;
    }
    if (typeof value !== 'string') return (this.fail(`${key} must be text`), required ? '' : undefined);
    const trimmed = value.trim();
    if (trimmed.length > max) this.fail(`${key} is ${trimmed.length} characters, at most ${max}`);
    return trimmed;
  }

  number(obj: Json, key: string, min: number, max: number): number | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return this.fail(`${key} must be a number`);
    if (value < min || value > max) return this.fail(`${key} must be between ${min} and ${max}`);
    return value;
  }

  list(obj: Json, key: string, min: number, max: number): unknown[] {
    const value = obj[key];
    if (!Array.isArray(value)) return (this.fail(`${key} must be a list`), []);
    if (value.length < min || value.length > max) this.fail(`${key} has ${value.length} entries, needs ${min} to ${max}`);
    return value;
  }

  url(obj: Json, key: string): string | undefined {
    const value = this.text(obj, key, 500);
    if (value === undefined) return undefined;
    try {
      if (new URL(value).protocol === 'https:') return value;
    } catch {}
    return this.fail(`${key} must be an https address`);
  }

  oneOf<T extends string>(obj: Json, key: string, options: readonly T[], fallback?: T): T | undefined {
    const value = obj[key] ?? fallback;
    if (value === undefined) return this.fail(`${key} is required`);
    return options.includes(value as T) ? (value as T) : this.fail(`${key} must be one of ${options.join(', ')}`);
  }

  image(obj: Json, key: string): BlockImage | undefined {
    const value = obj[key];
    if (!isObject(value)) return this.fail(`${key} must be an image`);
    const src = this.text(value, 'src', 2000, true);
    const alt = this.text(value, 'alt', 300, true);
    const width = this.number(value, 'width', 1, 20000);
    const height = this.number(value, 'height', 1, 20000);
    if (width === undefined || height === undefined) return this.fail(`${key} needs its width and height`);
    const image: BlockImage = { src, alt, width, height };
    const srcset = this.text(value, 'srcset', 4000);
    const sizes = this.text(value, 'sizes', 300);
    if (srcset) image.srcset = srcset;
    if (sizes) image.sizes = sizes;
    return image;
  }

  done<T>(value: T): Parsed<T> {
    return this.issues.length ? { ok: false, issues: this.issues } : { ok: true, value };
  }
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Drops the keys whose value is undefined, so a parsed block is the JSON it would serialize to. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// ---------------------------------------------------------------------------
// The chart's table, as an editor types or pastes it
// ---------------------------------------------------------------------------

/**
 * A number as an editor writes it in either language: `12`, `12,5`, `12.5`, `-3`. A thousands
 * separator is not allowed (`1.200` is ambiguous between the two languages): write `1200`.
 * An empty cell or `–` is a missing value.
 */
export function parseCell(cell: string): number | null | undefined {
  const raw = cell.trim().replace(/−/g, '-');
  if (raw === '' || raw === '–' || raw === '-') return null;
  if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return undefined;
  return Number(raw.replace(',', '.'));
}

/**
 * Labels and series from a table pasted from a spreadsheet or typed by hand: one row per
 * label, the first column the label, one column per series; the first row names the series.
 * Columns are separated by tabs (a spreadsheet's paste), semicolons or, without either, `|`.
 *
 *   Planstand; Büro A; Büro B
 *   Rev. A; 12; 9
 *   Rev. B; 7,5; 6
 */
export function parseChartTable(table: string): Parsed<{ labels: string[]; series: ChartSeries[] }> {
  const rows = table
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row !== '' && !/^\|?[\s:|-]+\|?$/.test(row));
  const separator = rows.some((r) => r.includes('\t')) ? '\t' : rows.some((r) => r.includes(';')) ? ';' : '|';
  const cells = rows.map((row) => row.replace(/^\||\|$/g, '').split(separator).map((c) => c.trim()));
  const issues: string[] = [];
  if (cells.length < 3) return { ok: false, issues: ['table: needs a header row and at least two rows of values'] };
  const [head, ...body] = cells;
  const names = head.slice(1);
  if (names.length === 0) issues.push('table: the header row names no series');
  const series: ChartSeries[] = names.map((name) => ({ name, values: [] }));
  const labels: string[] = [];
  body.forEach((row, r) => {
    if (row.length !== head.length) issues.push(`table: row ${r + 2} has ${row.length} columns, the header ${head.length}`);
    labels.push(row[0] ?? '');
    names.forEach((_, s) => {
      const value = parseCell(row[s + 1] ?? '');
      if (value === undefined) issues.push(`table: row ${r + 2}, column ${s + 2}: „${row[s + 1]}“ is not a number`);
      series[s].values.push(value ?? null);
    });
  });
  return issues.length ? { ok: false, issues } : { ok: true, value: { labels, series } };
}

// ---------------------------------------------------------------------------
// One parser per block
// ---------------------------------------------------------------------------

export function parseChart(json: unknown): Parsed<ChartBlock> {
  const r = new Reader('chart');
  if (!isObject(json)) return { ok: false, issues: ['chart: not an object'] };
  const form = r.oneOf(json, 'form', ['bar', 'line'] as const);
  let labels: unknown[];
  let rawSeries: unknown[];
  if (typeof json.table === 'string' && json.labels === undefined) {
    const table = parseChartTable(json.table);
    if (!table.ok) return { ok: false, issues: table.issues.map((i) => `chart: ${i}`) };
    labels = table.value.labels;
    rawSeries = table.value.series;
    if (labels.length > 24) r.fail(`labels has ${labels.length} entries, needs 2 to 24`);
    if (rawSeries.length > 3) r.fail(`series has ${rawSeries.length} entries, needs 1 to 3`);
  } else {
    labels = r.list(json, 'labels', 2, 24);
    rawSeries = r.list(json, 'series', 1, 3);
  }
  const labelTexts = labels.map((label, i) => (typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : (r.fail(`label ${i + 1} is empty`), '')));
  const series: ChartSeries[] = rawSeries.map((raw, s) => {
    if (!isObject(raw)) return (r.fail(`series ${s + 1} is not an object`), { name: '', values: [] });
    const name = r.text(raw, 'name', 40, true);
    const values = Array.isArray(raw.values) ? raw.values : [];
    if (values.length !== labelTexts.length) r.fail(`series „${name}“ has ${values.length} values for ${labelTexts.length} labels`);
    const numbers = values.map((v, i) => {
      if (v === null) return null;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      return (r.fail(`series „${name}“, value ${i + 1} is not a number`), null);
    });
    if (numbers.every((v) => v === null)) r.fail(`series „${name}“ has no values`);
    return { name, values: numbers };
  });
  const stacking = form === 'bar' ? r.oneOf(json, 'stacking', ['grouped', 'stacked'] as const, 'grouped') : undefined;
  if (stacking === 'stacked' && series.some((s) => s.values.some((v) => v !== null && v < 0))) r.fail('a stacked chart takes no negative values');
  if (form === 'line' && labelTexts.length < 2) r.fail('a line needs at least two points');
  const value: ChartBlock = compact({
    form: form ?? 'bar',
    stacking: stacking === 'stacked' && series.length > 1 ? stacking : undefined,
    title: r.text(json, 'title', 120, true),
    caption: r.text(json, 'caption', 240),
    unit: r.text(json, 'unit', 12),
    axisLabel: r.text(json, 'axisLabel', 60),
    decimals: r.number(json, 'decimals', 0, 2),
    startAtZero: form === 'line' && json.startAtZero === false ? false : undefined,
    labels: labelTexts,
    series,
    source: r.text(json, 'source', 200, true),
    sourceUrl: r.url(json, 'sourceUrl'),
  });
  return r.done(value);
}

export function parseKeyFigures(json: unknown): Parsed<KeyFiguresBlock> {
  const r = new Reader('keyFigures');
  if (!isObject(json)) return { ok: false, issues: ['keyFigures: not an object'] };
  const items = r.list(json, 'items', 2, 4).map((raw, i) => {
    if (!isObject(raw)) return (r.fail(`item ${i + 1} is not an object`), { value: '', label: '' });
    const value = r.text(raw, 'value', 8, true);
    if (value && !/\d/.test(value)) r.fail(`item ${i + 1}: value „${value}“ holds no digit`);
    return compact({ value, unit: r.text(raw, 'unit', 8), label: r.text(raw, 'label', 60, true), source: r.text(raw, 'source', 200) });
  });
  return r.done({ items });
}

export function parseCompare(json: unknown): Parsed<CompareBlock> {
  const r = new Reader('compare');
  if (!isObject(json)) return { ok: false, issues: ['compare: not an object'] };
  const before = r.image(json, 'before');
  const after = r.image(json, 'after');
  if (before && after && Math.abs(before.width / before.height - after.width / after.height) > 0.01 * (before.width / before.height)) {
    r.fail('before and after must have the same aspect ratio');
  }
  const value = compact({
    before: before as BlockImage,
    after: after as BlockImage,
    beforeLabel: r.text(json, 'beforeLabel', 40, true),
    afterLabel: r.text(json, 'afterLabel', 40, true),
    caption: r.text(json, 'caption', 240),
    start: r.number(json, 'start', 0, 100),
  });
  return r.done(value);
}

export function parseAnnotatedImage(json: unknown): Parsed<AnnotatedImageBlock> {
  const r = new Reader('annotatedImage');
  if (!isObject(json)) return { ok: false, issues: ['annotatedImage: not an object'] };
  const image = r.image(json, 'image');
  const markers = r.list(json, 'markers', 1, 9).map((raw, i) => {
    if (!isObject(raw)) return (r.fail(`marker ${i + 1} is not an object`), { x: 0, y: 0, title: '' });
    const x = r.number(raw, 'x', 0, 100);
    const y = r.number(raw, 'y', 0, 100);
    if (x === undefined || y === undefined) r.fail(`marker ${i + 1} needs x and y in percent`);
    return compact({ x: x ?? 0, y: y ?? 0, title: r.text(raw, 'title', 80, true), text: r.text(raw, 'text', 280) });
  });
  return r.done(compact({ image: image as BlockImage, markers, caption: r.text(json, 'caption', 240) }));
}

export function parseLegalSource(json: unknown): Parsed<LegalSourceBlock> {
  const r = new Reader('legalSource');
  if (!isObject(json)) return { ok: false, issues: ['legalSource: not an object'] };
  return r.done(
    compact({
      title: r.text(json, 'title', 80, true),
      section: r.text(json, 'section', 60),
      version: r.text(json, 'version', 60),
      issuer: r.text(json, 'issuer', 100),
      excerpt: r.text(json, 'excerpt', 600),
      url: r.url(json, 'url'),
    }),
  );
}

export function parseQaExcerpt(json: unknown): Parsed<QaExcerptBlock> {
  const r = new Reader('qaExcerpt');
  if (!isObject(json)) return { ok: false, issues: ['qaExcerpt: not an object'] };
  const sources = (Array.isArray(json.sources) ? r.list(json, 'sources', 0, 6) : []).map((raw, i) => {
    if (!isObject(raw)) return (r.fail(`source ${i + 1} is not an object`), { kind: 'project' as SourceKind, title: '' });
    return compact({ kind: r.oneOf(raw, 'kind', SOURCE_KINDS) ?? 'project', title: r.text(raw, 'title', 80, true), detail: r.text(raw, 'detail', 40) });
  });
  const sourceCount = r.number(json, 'sourceCount', 1, 999);
  if (sourceCount !== undefined && (!Number.isInteger(sourceCount) || sourceCount < sources.length)) {
    r.fail(`sourceCount must be a whole number of at least the ${sources.length} sources shown`);
  }
  return r.done(
    compact({
      question: r.text(json, 'question', 400, true),
      answer: r.text(json, 'answer', 2000, true),
      sources,
      sourceCount,
      asker: r.text(json, 'asker', 80),
      caption: r.text(json, 'caption', 240),
    }),
  );
}

export function parseKeyTakeaways(json: unknown): Parsed<KeyTakeawaysBlock> {
  const r = new Reader('keyTakeaways');
  if (!isObject(json)) return { ok: false, issues: ['keyTakeaways: not an object'] };
  const items = r.list(json, 'items', 3, 5).map((raw, i) => {
    const item = typeof raw === 'string' ? raw.trim() : isObject(raw) && typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!item) r.fail(`item ${i + 1} is empty`);
    if (item.length > 200) r.fail(`item ${i + 1} is ${item.length} characters, at most 200`);
    return item;
  });
  return r.done(compact({ title: r.text(json, 'title', 60), items }));
}

/**
 * Every block, by the type name the CMS gives it (Payload's `blockType`), with its parser.
 * A block the CMS adds here first and the site does not know yet is dropped by the mapper.
 */
export const BLOCK_PARSERS = {
  chart: parseChart,
  keyFigures: parseKeyFigures,
  compare: parseCompare,
  annotatedImage: parseAnnotatedImage,
  legalSource: parseLegalSource,
  qaExcerpt: parseQaExcerpt,
  keyTakeaways: parseKeyTakeaways,
} as const;

export type ContentBlockType = keyof typeof BLOCK_PARSERS;

export type ContentBlock =
  | ({ type: 'chart' } & ChartBlock)
  | ({ type: 'keyFigures' } & KeyFiguresBlock)
  | ({ type: 'compare' } & CompareBlock)
  | ({ type: 'annotatedImage' } & AnnotatedImageBlock)
  | ({ type: 'legalSource' } & LegalSourceBlock)
  | ({ type: 'qaExcerpt' } & QaExcerptBlock)
  | ({ type: 'keyTakeaways' } & KeyTakeawaysBlock);

/** One block from its type name and its fields, or the reasons it cannot be shown. */
export function parseContentBlock(type: string, json: unknown): Parsed<ContentBlock> {
  if (!(type in BLOCK_PARSERS)) return { ok: false, issues: [`${type}: not a block this site renders`] };
  const parsed = BLOCK_PARSERS[type as ContentBlockType](json);
  return parsed.ok ? { ok: true, value: { type, ...parsed.value } as ContentBlock } : parsed;
}
