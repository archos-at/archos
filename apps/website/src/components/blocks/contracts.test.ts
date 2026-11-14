/**
 * The blocks' contracts: what each parser accepts, what it refuses and why, the chart's typed
 * table, and the source kinds against the agent's vocabulary. README.md's example payloads are
 * parsed here too, so the document cannot drift from the code.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK_PARSERS, SOURCE_KINDS, parseCell, parseChart, parseChartTable, parseCompare, parseContentBlock, parseKeyFigures, parseKeyTakeaways, parseQaExcerpt } from './contracts';

const image = (width = 1600, height = 1000) => ({ src: '/a.png', alt: 'Grundriss', width, height });
const issues = (parsed: { ok: boolean; issues?: string[] }) => (parsed.ok ? [] : parsed.issues ?? []);

describe('the chart’s table', () => {
  test('reads both decimal marks and a missing value', () => {
    expect(parseCell('12,5')).toBe(12.5);
    expect(parseCell('12.5')).toBe(12.5);
    expect(parseCell('−3')).toBe(-3);
    expect(parseCell('')).toBeNull();
    expect(parseCell('–')).toBeNull();
    expect(parseCell('1.200,5')).toBeUndefined();
    expect(parseCell('12 h')).toBeUndefined();
  });

  test('reads a spreadsheet paste, a semicolon table and a Markdown table alike', () => {
    const expected = { labels: ['Rev. A', 'Rev. B'], series: [{ name: 'Büro A', values: [12, 7.5] }, { name: 'Büro B', values: [9, null] }] };
    for (const table of [
      'Planstand\tBüro A\tBüro B\nRev. A\t12\t9\nRev. B\t7,5\t',
      'Planstand; Büro A; Büro B\nRev. A; 12; 9\nRev. B; 7,5; –',
      '| Planstand | Büro A | Büro B |\n|---|---|---|\n| Rev. A | 12 | 9 |\n| Rev. B | 7,5 | – |',
    ]) {
      expect(parseChartTable(table)).toEqual({ ok: true, value: expected });
    }
  });

  test('names the cell that is not a number', () => {
    expect(issues(parseChartTable('X;A\nRev. A;12\nRev. B;zwölf'))).toEqual(['table: row 3, column 2: „zwölf“ is not a number']);
  });

  test('refuses a table without values', () => {
    expect(issues(parseChartTable('X;A'))[0]).toContain('header row');
  });
});

describe('parseChart', () => {
  const chart = { form: 'bar', title: 'Titel.', labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }], source: 'Beispielwerte' };

  test('accepts the typed shape and the table shape', () => {
    expect(parseChart(chart).ok).toBe(true);
    const fromTable = parseChart({ form: 'line', title: 'Titel.', table: 'KW;Offen\nKW 1;4\nKW 2;3', source: 'Beispielwerte' });
    expect(fromTable).toMatchObject({ ok: true, value: { labels: ['KW 1', 'KW 2'], series: [{ name: 'Offen', values: [4, 3] }] } });
  });

  test('requires a title and a source (Belegpflicht)', () => {
    const found = issues(parseChart({ ...chart, title: '', source: undefined }));
    expect(found).toContain('chart: title is required');
    expect(found).toContain('chart: source is required');
  });

  test('holds the series to the labels, and to at most three', () => {
    expect(issues(parseChart({ ...chart, series: [{ name: 'S', values: [1] }] }))[0]).toContain('1 values for 2 labels');
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, values: [1, 2] }));
    expect(issues(parseChart({ ...chart, series: four }))[0]).toContain('needs 1 to 3');
  });

  test('refuses negative values in a stack and a source link that is not https', () => {
    expect(issues(parseChart({ ...chart, stacking: 'stacked', series: [{ name: 'S', values: [1, -2] }, { name: 'T', values: [1, 1] }] }))).toContain(
      'chart: a stacked chart takes no negative values',
    );
    expect(issues(parseChart({ ...chart, sourceUrl: 'javascript:alert(1)' }))).toContain('chart: sourceUrl must be an https address');
  });

  test('drops what does not apply: stacking of one series, startAtZero of bars', () => {
    const parsed = parseChart({ ...chart, stacking: 'stacked', startAtZero: false });
    expect(parsed.ok && parsed.value.stacking).toBeUndefined();
    expect(parsed.ok && parsed.value.startAtZero).toBeUndefined();
  });
});

describe('the other blocks', () => {
  test('key figures: two to four, each with a digit', () => {
    expect(parseKeyFigures({ items: [{ value: '3', label: 'a' }, { value: '4', label: 'b' }] }).ok).toBe(true);
    expect(issues(parseKeyFigures({ items: [{ value: '3', label: 'a' }] }))[0]).toContain('needs 2 to 4');
    expect(issues(parseKeyFigures({ items: [{ value: 'viel', label: 'a' }, { value: '4', label: 'b' }] }))[0]).toContain('holds no digit');
  });

  test('compare: two images of one aspect ratio, with alt text', () => {
    const ok = { before: image(), after: image(800, 500), beforeLabel: 'Rev. C', afterLabel: 'Rev. D' };
    expect(parseCompare(ok).ok).toBe(true);
    expect(issues(parseCompare({ ...ok, after: image(800, 800) }))).toContain('compare: before and after must have the same aspect ratio');
    expect(issues(parseCompare({ ...ok, before: { ...image(), alt: '' } }))).toContain('compare: alt is required');
  });

  test('Q&A: sources of a known kind, and a count no smaller than the ones shown', () => {
    const qa = { question: 'Frage?', answer: 'Antwort.', sources: [{ kind: 'building_law', title: 'OIB-Richtlinie 2' }] };
    expect(parseQaExcerpt(qa).ok).toBe(true);
    expect(issues(parseQaExcerpt({ ...qa, sources: [{ kind: 'law', title: 'x' }] }))[0]).toContain('kind must be one of');
    expect(issues(parseQaExcerpt({ ...qa, sourceCount: 0 }))[0]).toContain('between 1 and 999');
  });

  test('key takeaways: three to five, as strings or as rows with a text', () => {
    expect(parseKeyTakeaways({ items: ['a', 'b', 'c'] })).toEqual({ ok: true, value: { items: ['a', 'b', 'c'] } });
    expect(parseKeyTakeaways({ items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }).ok).toBe(true);
    expect(issues(parseKeyTakeaways({ items: ['a', 'b'] }))[0]).toContain('needs 3 to 5');
  });

  test('an unknown block type is refused, not guessed', () => {
    expect(parseContentBlock('carousel', {})).toEqual({ ok: false, issues: ['carousel: not a block this site renders'] });
  });
});

describe('the contract document', () => {
  test('every example payload in README.md parses', () => {
    const readme = readFileSync(join(import.meta.dir, 'README.md'), 'utf8');
    const examples = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]) as { blockType: string });
    expect(examples.map((e) => e.blockType).sort()).toEqual(Object.keys(BLOCK_PARSERS).sort());
    for (const { blockType, ...fields } of examples) {
      expect({ blockType, issues: issues(parseContentBlock(blockType, fields)) }).toEqual({ blockType, issues: [] });
    }
  });
});

describe('source kinds', () => {
  test('mirror the agent’s vocabulary', () => {
    // The generated copy exists in the repository, not in the website's image: compare where it can be read.
    const generated = join(import.meta.dir, '../../../../workspace/shared/vocabularies.generated.ts');
    if (!existsSync(generated)) return;
    const line = readFileSync(generated, 'utf8').match(/export const SOURCE_KINDS = \[(.*?)\] as const/);
    expect(line).not.toBeNull();
    expect(JSON.parse(`[${line![1]}]`)).toEqual([...SOURCE_KINDS]);
  });
});
