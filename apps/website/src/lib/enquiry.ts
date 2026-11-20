import type { Locale } from '../i18n/paths';
import { mailBody, type MailLine } from './mailto';

export interface Enquiry {
  form: 'contact' | 'demo';
  locale: Locale;
  subject: string;
  email: string;
  name: string;
  lines: MailLine[];
  message: string;
}

export const FORMS = ['contact', 'demo'] as const;
export const TRAP_FIELD = 'website';

const LIMIT = { subject: 200, email: 254, name: 200, label: 80, value: 500, lines: 20, message: 5000 };
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const LINE_BREAK = /[\r\n]+/g;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : undefined;
}

/** One header-safe line: a break in a subject or name would start a new mail header. */
function oneLine(value: string): string {
  return value.replace(LINE_BREAK, ' ');
}

export type Parsed = { ok: true; enquiry: Enquiry } | { ok: false; trap: boolean };

export function parseEnquiry(body: unknown): Parsed {
  if (!body || typeof body !== 'object') return { ok: false, trap: false };
  const raw = body as Record<string, unknown>;
  if (typeof raw[TRAP_FIELD] === 'string' && raw[TRAP_FIELD] !== '') return { ok: false, trap: true };

  const form = FORMS.find((f) => f === raw.form);
  const locale = raw.locale === 'en' ? 'en' : raw.locale === 'de' ? 'de' : undefined;
  const subject = text(raw.subject, LIMIT.subject);
  const email = text(raw.email, LIMIT.email);
  const name = text(raw.name, LIMIT.name);
  const message = text(raw.message ?? '', LIMIT.message);
  if (!form || !locale || !subject || !email || !EMAIL.test(email) || !name || message === undefined) {
    return { ok: false, trap: false };
  }
  if (!Array.isArray(raw.lines) || raw.lines.length > LIMIT.lines) return { ok: false, trap: false };
  const lines: MailLine[] = [];
  for (const line of raw.lines) {
    const label = text((line as MailLine | null)?.label, LIMIT.label);
    const value = text((line as MailLine | null)?.value, LIMIT.value);
    if (label === undefined || value === undefined) return { ok: false, trap: false };
    lines.push({ label: oneLine(label), value: oneLine(value) });
  }
  return { ok: true, enquiry: { form, locale, subject: oneLine(subject), email, name: oneLine(name), lines, message } };
}

export function enquiryText(enquiry: Enquiry): string {
  return mailBody(enquiry.lines, enquiry.message);
}

export function splitNameLastWordAsSurname(name: string): { first_name: string; last_name: string; full_name: string } {
  const words = name.split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.pop() ?? '' : '';
  return { first_name: words.join(' '), last_name: last, full_name: name };
}

/** Counted per process: the site-wide ceiling is the replica count times the limit. */
export class SendBudget {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const recent = (this.seen.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    if (this.seen.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.seen) {
      if (times.every((t) => now - t >= this.windowMs)) this.seen.delete(key);
    }
  }
}
