import type { Locale } from '../i18n/paths';
import identity from './identity';
import type { MailLine } from './mailto';

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

function block(tokensCss: string, selector: string): string {
  const start = tokensCss.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
  return tokensCss.slice(start, tokensCss.indexOf('}', start));
}

function theme(css: string): Theme {
  const colour = (name: string) => {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
    if (!match) throw new Error(`tokens.css has no --${name} colour`);
    return match[1];
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

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lines = (text: string) => escape(text).replace(/\r?\n/g, '<br>');

const SANS = `font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;`;
const LOGO = `font-family:Switzer,'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;`;
const BODY = `${SANS}font-size:16px;line-height:24px;letter-spacing:0.01em;`;
const SMALL = `${SANS}font-size:14px;line-height:20px;letter-spacing:0.01em;`;

const row = (style: string, html: string) => `<tr><td style="${style}">${html}</td></tr>`;
const table = (rows: string, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${style}">${rows}</table>`;

function fontFaces(fonts: MailLook['fonts']): string {
  if (!fonts) return '';
  return `<style>
@font-face{font-family:'General Sans';src:url('${escape(fonts.sans)}') format('woff2');font-weight:200 700;}
@font-face{font-family:Switzer;src:url('${escape(fonts.logo)}') format('woff2');font-weight:600;}
@media (max-width:600px){.ar-title{font-size:26px!important;line-height:32px!important;}.ar-pad{padding-left:16px!important;padding-right:16px!important;}}
</style>`;
}

const padded = (style: string, html: string) => row(`padding:0 40px 0 40px;${style}`, html).replace('<td ', '<td class="ar-pad" ');

const wordmark = (size: number, colour: string) =>
  `<span style="${LOGO}font-size:${size}px;line-height:1;letter-spacing:-0.02em;color:${colour};">${escape(identity.name.toUpperCase())}</span>`;

/** The page every mail sits on: wordmark, a heading-2 title, the content, and the dark footer of the website. */
function page(look: MailLook, locale: Locale, title: string, preview: string, content: string): string {
  const { light: l, dark: d } = look;
  const site = `https://${identity.domain}`;
  const footer = table(
    padded('padding-top:48px;', wordmark(28, d.ink)) +
      padded(`padding-top:12px;${SMALL}color:${d.inkMuted};`, escape(identity.tagline)) +
      padded(
        `padding-top:32px;padding-bottom:40px;${SMALL}color:${d.inkMuted};`,
        `${escape(identity.legalEntity)}<br>${escape(identity.street)}, ${escape(identity.postalCode)} ${escape(identity.city)}<br>` +
          `<a href="mailto:${escape(identity.email)}" style="color:${d.ink};text-decoration:none;">${escape(identity.email)}</a> · ` +
          `<a href="${escape(site)}" style="color:${d.ink};text-decoration:none;">${escape(identity.domain)}</a>`,
      ),
    `background:${d.surface};`,
  );
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title>${fontFaces(look.fonts)}</head>
<body style="margin:0;padding:0;background:${l.surface};">
<div style="display:none;max-height:0;overflow:hidden;">${escape(preview)}</div>
${table(
  row(
    `padding:40px 16px;`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:600px;margin:0 auto;">` +
      row(`padding:0 40px 64px 40px;`, wordmark(22, l.ink)).replace('<td ', '<td class="ar-pad" ') +
      row(
        `padding:0 40px 32px 40px;${SANS}font-size:32px;line-height:38px;letter-spacing:0.005em;color:${l.ink};`,
        escape(title),
      ).replace('<td ', '<td class="ar-title ar-pad" ') +
      content +
      row('padding:64px 0 0 0;', footer) +
      `</table>`,
  ),
  `background:${l.surface};`,
)}
</body>
</html>`;
}


export function confirmationHtml(look: MailLook, locale: Locale, title: string, body: string[]): string {
  const [first, ...rest] = body;
  const { light: l } = look;
  const content =
    padded(`padding-bottom:16px;${BODY}color:${l.ink};`, lines(first ?? '')) +
    rest.map((part) => padded(`padding-bottom:16px;${BODY}color:${l.inkMuted};`, lines(part))).join('');
  return page(look, locale, title, first ?? title, content);
}

export interface NotificationParts {
  title: string;
  lines: MailLine[];
  message: string;
  reply: { label: string; to: string; subject: string };
  hint: string;
}

/** The fields as the website's InfoList: term in ink, value in ink-muted, 2:3, a fine line between rows. */
export function notificationHtml(look: MailLook, locale: Locale, parts: NotificationParts): string {
  const { light: l } = look;
  const info = parts.lines
    .filter((line) => line.value.trim() !== '')
    .map(
      (line) =>
        `<tr><td width="40%" style="padding:20px 16px 20px 0;border-top:1px solid ${l.line};vertical-align:top;${BODY}color:${l.ink};">${escape(line.label)}</td>` +
        `<td style="padding:20px 0;border-top:1px solid ${l.line};vertical-align:top;${BODY}color:${l.inkMuted};">${escape(line.value)}</td></tr>`,
    )
    .join('');
  const message = parts.message.trim()
    ? padded('padding-top:32px;', table(row(`padding:24px;${BODY}color:${l.ink};`, lines(parts.message.trim())), `background:${l.surfaceSunken};`))
    : '';
  const href = `mailto:${parts.reply.to}?subject=${encodeURIComponent(`Re: ${parts.reply.subject}`)}`;
  const button =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${l.ink};border-radius:4px;">` +
    `<a href="${escape(href)}" style="display:inline-block;padding:13px 24px;${BODY}color:${l.surface};text-decoration:none;">${escape(parts.reply.label)}</a></td></tr></table>`;
  const content =
    padded('', table(info + `<tr><td colspan="2" style="border-top:1px solid ${l.line};font-size:0;line-height:0;">&nbsp;</td></tr>`)) +
    message +
    padded('padding-top:40px;', button) +
    padded(`padding-top:16px;${SMALL}color:${l.inkMuted};`, escape(parts.hint));
  return page(look, locale, parts.title, parts.lines.map((line) => line.value).join(' · '), content);
}
