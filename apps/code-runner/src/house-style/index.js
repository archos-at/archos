import brand from "./brand/document-colors.json";

export const colors = Object.freeze({
  paper: "#ffffff",
  band: brand["surface-sunken"],
  line: brand.line,
  lineStrong: brand["line-strong"],
  ink: brand.ink,
  text: brand["ink-hover"],
  muted: brand["ink-muted"],
  faint: brand["ink-faint"],
  markup: brand.markup,
  markupSoft: brand["markup-soft"],
});

export const series = Object.freeze([colors.ink, colors.muted, colors.lineStrong]);

export const fonts = Object.freeze({ office: "Aptos", pdf: "Hanken Grotesk", pdfFallback: "Source Sans 3", mono: "Source Code Pro" });

export const hex = (color) => color.replace(/^#/, "").toUpperCase();

const argb = (color) => `FF${hex(color)}`;

const numberFormat = (digits) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const format = Object.freeze({
  number: (value, digits = 2) => numberFormat(digits).format(value),
  area: (value) => `${numberFormat(2).format(value)} m²`,
  date: (value) =>
    new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      value instanceof Date ? value : new Date(value),
    ),
});

const SLIDE = { w: 10, h: 5.625, x: 0.6, right: 0.6 };
const CONTENT = { x: SLIDE.x, y: 1.45, w: SLIDE.w - SLIDE.x - SLIDE.right, h: 3.5 };
const GAP = 0.4;
const HALF = (CONTENT.w - GAP) / 2;

const BOXES = {
  full: { x: CONTENT.x, y: CONTENT.y, w: CONTENT.w, h: CONTENT.h },
  left: { x: CONTENT.x, y: CONTENT.y, w: HALF, h: CONTENT.h },
  right: { x: CONTENT.x + HALF + GAP, y: CONTENT.y, w: HALF, h: CONTENT.h },
  wide: { x: CONTENT.x, y: CONTENT.y, w: CONTENT.w * 0.62, h: CONTENT.h },
  aside: { x: CONTENT.x + CONTENT.w * 0.62 + GAP, y: CONTENT.y, w: CONTENT.w * 0.38 - GAP, h: CONTENT.h },
};

const titleOptions = () => ({
  x: SLIDE.x, y: 0.45, w: CONTENT.w, h: 0.75,
  fontFace: fonts.office, fontSize: 26, color: hex(colors.ink), align: "left", valign: "top", margin: 0, fit: "none",
});

const footerOptions = () => ({
  x: SLIDE.x, y: 5.12, w: CONTENT.w - 0.8, h: 0.25,
  fontFace: fonts.office, fontSize: 9, color: hex(colors.muted), margin: 0, valign: "middle",
});

const slideNumber = () => ({
  x: SLIDE.w - SLIDE.right - 0.6, y: 5.12, w: 0.6, h: 0.25,
  fontFace: fonts.office, fontSize: 9, color: hex(colors.muted), align: "right", margin: 0,
});

export function houseDeck(pptx, { footer = "" } = {}) {
  pptx.layout = "LAYOUT_16x9";
  pptx.theme = { headFontFace: fonts.office, bodyFontFace: fonts.office };
  const background = { color: hex(colors.paper) };
  const footerObject = footer ? [{ text: { text: footer, options: footerOptions() } }] : [];

  pptx.defineSlideMaster({
    title: "HOUSE_CONTENT",
    background,
    objects: [{ placeholder: { options: { name: "title", type: "title", ...titleOptions() }, text: "" } }, ...footerObject],
    slideNumber: slideNumber(),
  });
  pptx.defineSlideMaster({
    title: "HOUSE_SECTION",
    background: { color: hex(colors.band) },
    objects: [
      { placeholder: { options: { name: "title", type: "title", ...titleOptions(), y: 2.2, h: 1.2, fontSize: 32 }, text: "" } },
      ...footerObject,
    ],
    slideNumber: slideNumber(),
  });
  pptx.defineSlideMaster({ title: "HOUSE_COVER", background, objects: [] });

  return {
    box: (name = "full") => ({ ...BOXES[name] }),
    cover({ title, subtitle = "", meta = "" }) {
      const slide = pptx.addSlide({ masterName: "HOUSE_COVER" });
      slide.addText(title, {
        x: SLIDE.x, y: 2.35, w: CONTENT.w, h: 1.2, fontFace: fonts.office, fontSize: 36,
        color: hex(colors.ink), valign: "bottom", margin: 0,
      });
      if (subtitle) {
        slide.addText(subtitle, {
          x: SLIDE.x, y: 3.65, w: CONTENT.w, h: 0.5, fontFace: fonts.office, fontSize: 16,
          color: hex(colors.text), valign: "top", margin: 0,
        });
      }
      if (meta) {
        slide.addText(meta, {
          x: SLIDE.x, y: 4.85, w: CONTENT.w, h: 0.3, fontFace: fonts.office, fontSize: 10,
          color: hex(colors.muted), margin: 0,
        });
      }
      return slide;
    },
    section(title) {
      const slide = pptx.addSlide({ masterName: "HOUSE_SECTION" });
      slide.addText(title, { placeholder: "title" });
      return slide;
    },
    slide(title) {
      const slide = pptx.addSlide({ masterName: "HOUSE_CONTENT" });
      slide.addText(title, { placeholder: "title" });
      return slide;
    },
    text: (box = "full", extra = {}) => ({
      ...BOXES[box], fontFace: fonts.office, fontSize: 16, color: hex(colors.text),
      valign: "top", margin: 0, paraSpaceAfter: 8, ...extra,
    }),
    bullets: (items) =>
      items.map((text) => ({ text, options: { bullet: { indent: 18 }, breakLine: true } })),
    table(rows, { numeric = [], total = false } = {}) {
      const last = rows.length - 1;
      return rows.map((row, r) =>
        row.map((cell, c) => {
          const text = typeof cell === "object" && cell !== null ? cell.text : String(cell);
          const head = r === 0;
          const sum = total && r === last;
          return {
            text,
            options: {
              bold: head || sum,
              color: hex(head ? colors.muted : colors.text),
              align: numeric.includes(c) ? "right" : "left",
              border: [
                { type: sum ? "solid" : "none", pt: 0.75, color: hex(colors.ink) },
                { type: "none" },
                { type: "solid", pt: head ? 0.75 : 0.5, color: hex(head ? colors.ink : colors.line) },
                { type: "none" },
              ],
            },
          };
        }),
      );
    },
    tableOptions: (box = "full", extra = {}) => ({
      ...BOXES[box], h: undefined, fontFace: fonts.office, fontSize: 12, margin: [4, 6, 4, 0], valign: "middle", ...extra,
    }),
    chart: (box = "full", { series: count = 1, ...extra } = {}) => ({
      ...BOXES[box],
      chartColors: series.slice(0, Math.min(Math.max(count, 1), series.length)).map(hex),
      fontFace: fonts.office,
      catAxisLabelFontFace: fonts.office, valAxisLabelFontFace: fonts.office, dataLabelFontFace: fonts.office,
      legendFontFace: fonts.office, titleFontFace: fonts.office,
      catAxisLabelColor: hex(colors.muted), valAxisLabelColor: hex(colors.muted), dataLabelColor: hex(colors.text),
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 10, legendFontSize: 10,
      catAxisLineShow: true, catAxisLineColor: hex(colors.lineStrong), valAxisLineShow: false,
      valGridLine: { color: hex(colors.line), size: 0.5 },
      valAxisMinVal: 0, barGapWidthPct: 60, showLegend: count > 1, legendPos: "b",
      ...extra,
    }),
  };
}

export const css = `
@page { size: A4; margin: 28mm 22mm 24mm; }
:root {
  --ink: ${colors.ink}; --text: ${colors.text}; --muted: ${colors.muted}; --faint: ${colors.faint};
  --line: ${colors.line}; --line-strong: ${colors.lineStrong}; --band: ${colors.band};
  --markup: ${colors.markup}; --markup-soft: ${colors.markupSoft};
}
* { box-sizing: border-box; }
html { font-family: "${fonts.pdf}", "${fonts.pdfFallback}", sans-serif; font-size: 10pt; line-height: 1.5; color: var(--text); background: #ffffff; }
body { margin: 0; }
h1, h2, h3 { color: var(--ink); font-weight: 600; line-height: 1.2; margin: 0; text-wrap: balance; break-after: avoid; }
h1 { font-size: 22pt; font-weight: 500; margin: 0 0 4mm; }
h2 { font-size: 13pt; margin: 9mm 0 3mm; }
h3 { font-size: 10.5pt; margin: 6mm 0 2mm; }
p { margin: 0 0 3mm; max-width: 165mm; }
ul, ol { margin: 0 0 3mm; padding-left: 5mm; }
li { margin-bottom: 1mm; }
a { color: inherit; }
.meta, figcaption, .source { color: var(--muted); font-size: 8.5pt; }
.meta { margin-bottom: 10mm; }
.lead { font-size: 12pt; color: var(--ink); max-width: 150mm; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 5mm; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 600; font-size: 8.5pt; color: var(--muted); border-bottom: 0.75pt solid var(--ink); padding: 0 3mm 1.5mm 0; vertical-align: bottom; }
td { border-bottom: 0.5pt solid var(--line); padding: 1.6mm 3mm 1.6mm 0; vertical-align: top; }
th:last-child, td:last-child { padding-right: 0; }
.n { text-align: right; white-space: nowrap; }
tr { break-inside: avoid; }
tfoot td { font-weight: 600; color: var(--ink); border-top: 0.75pt solid var(--ink); border-bottom: none; }
figure { margin: 4mm 0 6mm; break-inside: avoid; }
figure img, figure svg { display: block; max-width: 100%; }
.band { background: var(--band); padding: 5mm 6mm; margin: 4mm 0 6mm; }
.finding { border-left: 1.5pt solid var(--markup); padding: 0.5mm 0 0.5mm 4mm; margin: 0 0 4mm; }
.finding strong { color: var(--markup); font-weight: 600; }
.figures { display: flex; gap: 8mm; margin: 2mm 0 8mm; }
.figures div { flex: 1; }
.figures b { display: block; font-size: 20pt; font-weight: 500; color: var(--ink); line-height: 1.1; font-variant-numeric: tabular-nums; }
.figures span { color: var(--muted); font-size: 8.5pt; }
.cover { height: 225mm; display: flex; flex-direction: column; justify-content: flex-end; break-after: page; }
.cover h1 { font-size: 32pt; line-height: 1.1; margin-bottom: 5mm; }
.cover .meta { margin: 0; }
`;

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function pdfFooter(left = "") {
  return `<div style="font-family: '${fonts.pdf}', '${fonts.pdfFallback}', sans-serif; font-size: 7.5pt; color: ${colors.muted}; width: 100%; margin: 0 22mm; display: flex; justify-content: space-between;"><span>${escapeHtml(left)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

export function htmlPage({ title = "", lang = "de", body = "" }) {
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

export const pdfOptions = (footer = "") => ({
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: pdfFooter(footer),
});

const typstColor = (color) => `rgb("${color}")`;

export const typstPreamble = String.raw`
#let house = (
  ink: ${typstColor(colors.ink)}, text: ${typstColor(colors.text)}, muted: ${typstColor(colors.muted)},
  line: ${typstColor(colors.line)}, strong: ${typstColor(colors.lineStrong)}, band: ${typstColor(colors.band)},
  markup: ${typstColor(colors.markup)}, markup-soft: ${typstColor(colors.markupSoft)},
)
#let house-input(key) = sys.inputs.at(key, default: "")
#set page(paper: "a4", margin: (x: 22mm, top: 28mm, bottom: 24mm),
  header: context {
    if counter(page).get().first() > 1 {
      set text(7.5pt, fill: house.muted)
      house-input("house-header")
    }
  },
  footer: context {
    set text(7.5pt, fill: house.muted)
    house-input("house-footer")
    h(1fr)
    [#counter(page).display() / #counter(page).final().first()]
  })
#set text(font: ("${fonts.pdf}", "${fonts.pdfFallback}"), size: 10pt, fill: house.text, lang: if house-input("house-lang") == "" { "de" } else { house-input("house-lang") })
#set par(leading: 0.62em, spacing: 1.1em)
#show heading: set text(fill: house.ink, weight: "semibold")
#show heading.where(level: 1): set text(17pt, weight: "medium")
#show heading.where(level: 2): set text(12.5pt)
#show heading.where(level: 3): set text(10.5pt)
#show heading: it => block(above: 1.8em, below: 0.9em, sticky: true, it)
#show raw: set text(font: "${fonts.mono}", size: 9pt)
#set list(marker: [–], indent: 0.2em)
#set table(
  stroke: (_, y) => (
    top: if y == 1 { 0.75pt + house.ink },
    bottom: if y >= 1 { 0.5pt + house.line } else { none },
  ),
  inset: (x: 0.5em, y: 0.55em),
)
#show table.cell.where(y: 0): set text(8.5pt, fill: house.muted, weight: "semibold")
#show table: set text(9.5pt, number-type: "lining", number-width: "tabular")
#let house-title(title, subtitle: none, meta: none) = block(below: 2.4em, {
  text(24pt, fill: house.ink, weight: "medium", title)
  if subtitle != none { v(0.4em); text(12pt, fill: house.text, subtitle) }
  if meta != none { v(0.9em); text(8.5pt, fill: house.muted, meta) }
})
#let house-band(body) = block(fill: house.band, inset: (x: 6mm, y: 5mm), width: 100%, body)
#let house-finding(label, body) = block(stroke: (left: 1.5pt + house.markup), inset: (left: 4mm, y: 1mm), below: 1.2em,
  [#text(fill: house.markup, weight: "semibold", label) #h(0.4em) #body])
#let house-figures(..pairs) = grid(columns: pairs.pos().len(), column-gutter: 8mm,
  ..pairs.pos().map(((value, label)) => [#text(20pt, fill: house.ink, weight: "medium", value) \ #text(8.5pt, fill: house.muted, label)]))
`;

export const typstInputs = ({ header = "", footer = "", lang = "de" } = {}) => ({
  "house-header": String(header),
  "house-footer": String(footer),
  "house-lang": String(lang),
});

export const vegaLiteConfig = {
  background: colors.paper,
  font: fonts.pdf,
  padding: 8,
  view: { stroke: null },
  mark: { color: colors.ink },
  bar: { color: colors.ink, cornerRadius: 0 },
  line: { color: colors.ink, strokeWidth: 1.5 },
  point: { color: colors.ink, filled: true, size: 30 },
  range: { category: [...series], ordinal: [...series], ramp: [colors.band, colors.ink] },
  axis: {
    labelColor: colors.muted, titleColor: colors.muted, labelFontSize: 10, titleFontSize: 10,
    titleFontWeight: 500, domainColor: colors.lineStrong, tickColor: colors.lineStrong, gridColor: colors.line,
    labelFont: fonts.pdf, titleFont: fonts.pdf,
  },
  axisX: { grid: false },
  axisY: { domain: false, ticks: false, labelPadding: 6 },
  legend: { labelColor: colors.text, titleColor: colors.muted, labelFontSize: 10, titleFontSize: 10, orient: "bottom", symbolType: "square" },
  title: { color: colors.ink, fontSize: 13, fontWeight: 600, anchor: "start", font: fonts.pdf, offset: 12 },
  text: { color: colors.text, font: fonts.pdf, fontSize: 10 },
};

const HALF_POINTS = (pt) => Math.round(pt * 2);
const TWIPS_PER_MM = 56.6929;
const twips = (mm) => Math.round(mm * TWIPS_PER_MM);

export const docxStyles = {
  default: {
    document: {
      run: { font: fonts.office, size: HALF_POINTS(10), color: hex(colors.text) },
      paragraph: { spacing: { after: 120, line: 300 } },
    },
    title: { run: { font: fonts.office, size: HALF_POINTS(24), color: hex(colors.ink) }, paragraph: { spacing: { after: 120 } } },
    heading1: { run: { font: fonts.office, size: HALF_POINTS(16), color: hex(colors.ink), bold: false }, paragraph: { spacing: { before: 480, after: 160 }, keepNext: true } },
    heading2: { run: { font: fonts.office, size: HALF_POINTS(12), color: hex(colors.ink), bold: true }, paragraph: { spacing: { before: 320, after: 100 }, keepNext: true } },
    heading3: { run: { font: fonts.office, size: HALF_POINTS(10), color: hex(colors.ink), bold: true }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true } },
    hyperlink: { run: { color: hex(colors.ink), underline: { type: "single" } } },
  },
  paragraphStyles: [
    { id: "Meta", name: "Meta", basedOn: "Normal", run: { size: HALF_POINTS(8.5), color: hex(colors.muted) }, paragraph: { spacing: { after: 360 } } },
  ],
};

export const docxPage = {
  size: { width: twips(210), height: twips(297) },
  margin: { top: twips(28), right: twips(22), bottom: twips(24), left: twips(22), header: twips(12), footer: twips(12) },
};

export const docxTableBorders = () => ({
  top: { style: "none", size: 0, color: "auto" },
  left: { style: "none", size: 0, color: "auto" },
  right: { style: "none", size: 0, color: "auto" },
  bottom: { style: "single", size: 4, color: hex(colors.line) },
  insideHorizontal: { style: "single", size: 4, color: hex(colors.line) },
  insideVertical: { style: "none", size: 0, color: "auto" },
});

export const docxHeaderCell = () => ({
  borders: { bottom: { style: "single", size: 6, color: hex(colors.ink) } },
  margins: { top: 60, bottom: 60, left: 0, right: 120 },
});

export function styleSheet(worksheet, { header = 1, numeric = [], numFmt = "#,##0.00", total = false } = {}) {
  const font = { name: fonts.office, size: 10, color: { argb: argb(colors.text) } };
  worksheet.eachRow({ includeEmpty: false }, (row, number) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { ...font, ...(number === header ? { bold: true, color: { argb: argb(colors.ink) } } : {}) };
      if (numeric.includes(col) && number > header) {
        cell.numFmt = numFmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: numeric.includes(col) ? "right" : "left", vertical: "middle", wrapText: number > header };
      }
      if (number === header) cell.border = { bottom: { style: "thin", color: { argb: argb(colors.ink) } } };
    });
  });
  if (total) {
    const last = worksheet.lastRow;
    last.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...font, bold: true, color: { argb: argb(colors.ink) } };
      cell.border = { top: { style: "thin", color: { argb: argb(colors.ink) } } };
    });
  }
  worksheet.views = [{ state: "frozen", ySplit: header }];
  if (header >= 1) worksheet.getRow(header).height = 20;
  return worksheet;
}
