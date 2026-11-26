export interface Theme {
  surface: string;
  surfaceSunken: string;
  line: string;
  ink: string;
  inkMuted: string;
}

export interface MailLook {
  light: Theme;
  dark: Theme;
  /** Absolute URLs: clients that load web fonts (Apple Mail, iOS) get General Sans and Switzer, the rest Helvetica. */
  fonts?: { sans: string; logo: string };
}

export interface SenderIdentity {
  name: string;
  tagline: string;
  legalEntity: string;
  street: string;
  postalCode: string;
  city: string;
  email: string;
  domain: string;
}

const COLOUR_VARIABLE = /--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;

function block(tokensCss: string, selector: string): string {
  const start = tokensCss.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
  return tokensCss.slice(start, tokensCss.indexOf('}', start));
}

function theme(css: string): Theme {
  const colours = new Map([...css.matchAll(COLOUR_VARIABLE)].map(([, name, value]) => [name, value]));
  const colour = (name: string) => {
    const value = colours.get(name);
    if (!value) throw new Error(`tokens.css has no --${name} colour`);
    return value;
  };
  return {
    surface: colour('surface'),
    surfaceSunken: colour('surface-sunken'),
    line: colour('line'),
    ink: colour('ink'),
    inkMuted: colour('ink-muted'),
  };
}

export function mailLook(tokensCss: string, fonts?: MailLook['fonts']): MailLook {
  return { light: theme(block(tokensCss, ':root')), dark: theme(block(tokensCss, '[data-theme="dark"]')), fonts };
}

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const withBreaks = (text: string) => escapeHtml(text).replace(/\r?\n/g, '<br>');

const SANS = `font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;`;
const LOGO = `font-family:Switzer,'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;`;
const BODY = `${SANS}font-size:16px;line-height:24px;letter-spacing:0.01em;`;
const SMALL = `${SANS}font-size:14px;line-height:20px;letter-spacing:0.01em;`;

const row = (style: string, html: string, cls = '') => `<tr><td${cls ? ` class="${cls}"` : ''} style="${style}">${html}</td></tr>`;
const table = (rows: string, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${style}">${rows}</table>`;
const padded = (style: string, html: string) => row(`padding:0 40px 0 40px;${style}`, html, 'ar-pad');

export type Block = (look: MailLook) => string;

export const paragraph =
  (text: string, tone: 'ink' | 'muted' = 'ink'): Block =>
  ({ light: l }) =>
    padded(`padding-bottom:16px;${BODY}color:${tone === 'ink' ? l.ink : l.inkMuted};`, withBreaks(text));

export const note =
  (text: string): Block =>
  ({ light: l }) =>
    padded(`padding-top:16px;${SMALL}color:${l.inkMuted};`, escapeHtml(text));

export const infoList =
  (rows: { label: string; value: string }[]): Block =>
  ({ light: l }) => {
    const cells = rows
      .filter((r) => r.value.trim() !== '')
      .map(
        (r) =>
          `<tr><td width="40%" style="padding:20px 16px 20px 0;border-top:1px solid ${l.line};vertical-align:top;${BODY}color:${l.ink};">${escapeHtml(r.label)}</td>` +
          `<td style="padding:20px 0;border-top:1px solid ${l.line};vertical-align:top;${BODY}color:${l.inkMuted};">${escapeHtml(r.value)}</td></tr>`,
      )
      .join('');
    return padded('', table(cells + `<tr><td colspan="2" style="border-top:1px solid ${l.line};font-size:0;line-height:0;">&nbsp;</td></tr>`));
  };

export const panel =
  (text: string): Block =>
  ({ light: l }) =>
    text.trim()
      ? padded('padding-top:32px;', table(row(`padding:24px;${BODY}color:${l.ink};`, withBreaks(text.trim())), `background:${l.surfaceSunken};`))
      : '';

/** The one primary action of a mail: black, 4px radius, as the design system's primary Button. */
export const button =
  (label: string, href: string): Block =>
  ({ light: l }) =>
    padded(
      'padding-top:40px;',
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${l.ink};border-radius:4px;">` +
        `<a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;${BODY}color:${l.surface};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`,
    );

const wordmark = (sender: SenderIdentity, size: number, colour: string) =>
  `<span style="${LOGO}font-size:${size}px;line-height:1;letter-spacing:-0.02em;color:${colour};">${escapeHtml(sender.name.toUpperCase())}</span>`;

function fontFaces(fonts: MailLook['fonts']): string {
  const mobile = `@media (max-width:600px){.ar-title{font-size:26px!important;line-height:32px!important;}.ar-pad{padding-left:16px!important;padding-right:16px!important;}}`;
  if (!fonts) return `<style>${mobile}</style>`;
  return `<style>
@font-face{font-family:'General Sans';src:url('${escapeHtml(fonts.sans)}') format('woff2');font-weight:200 700;}
@font-face{font-family:Switzer;src:url('${escapeHtml(fonts.logo)}') format('woff2');font-weight:600;}
${mobile}
</style>`;
}

export interface Page {
  lang: string;
  title: string;
  inboxPreview: string;
  blocks: Block[];
}

export function mailPage(look: MailLook, sender: SenderIdentity, page: Page): string {
  const { light: l, dark: d } = look;
  const site = `https://${sender.domain}`;
  const footer = table(
    padded('padding-top:48px;', wordmark(sender, 28, d.ink)) +
      padded(`padding-top:12px;${SMALL}color:${d.inkMuted};`, escapeHtml(sender.tagline)) +
      padded(
        `padding-top:32px;padding-bottom:40px;${SMALL}color:${d.inkMuted};`,
        `${escapeHtml(sender.legalEntity)}<br>${escapeHtml(sender.street)}, ${escapeHtml(sender.postalCode)} ${escapeHtml(sender.city)}<br>` +
          `<a href="mailto:${escapeHtml(sender.email)}" style="color:${d.ink};text-decoration:none;">${escapeHtml(sender.email)}</a> · ` +
          `<a href="${escapeHtml(site)}" style="color:${d.ink};text-decoration:none;">${escapeHtml(sender.domain)}</a>`,
      ),
    `background:${d.surface};`,
  );
  const inner =
    padded('padding-bottom:64px;', wordmark(sender, 22, l.ink)) +
    row(`padding:0 40px 32px 40px;${SANS}font-size:32px;line-height:38px;letter-spacing:0.005em;color:${l.ink};`, escapeHtml(page.title), 'ar-title ar-pad') +
    page.blocks.map((b) => b(look)).join('') +
    row('padding:64px 0 0 0;', footer);
  return `<!doctype html>
<html lang="${escapeHtml(page.lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(page.title)}</title>${fontFaces(look.fonts)}</head>
<body style="margin:0;padding:0;background:${l.surface};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(page.inboxPreview)}</div>
${table(row('padding:40px 16px;', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:600px;margin:0 auto;">${inner}</table>`), `background:${l.surface};`)}
</body>
</html>`;
}
