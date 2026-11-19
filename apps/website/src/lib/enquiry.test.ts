import { describe, expect, test } from 'bun:test';
import { confirmation, deliver, deliveryFrom, notification, recordInAttio, type Mail } from './enquiry-delivery';
import { parseEnquiry, SendBudget, splitNameLastWordAsSurname, TRAP_FIELD, type Enquiry } from './enquiry';
import { mailLook, smtpTransportOptions } from './mail';
import identity from './identity';

const TOKENS = `:root {
  --surface: #fafaf9; --surface-sunken: #f2f1f0; --line: #e7e5e3; --ink: #0f0e0d; --ink-muted: #5e5b57;
}
[data-theme="dark"] {
  --surface: #0f0e0d; --surface-sunken: #0a0908; --line: #2c2a27; --ink: #f5f4f2; --ink-muted: #a6a39e;
}`;
const look = mailLook(TOKENS);

const valid = {
  form: 'contact',
  locale: 'de',
  subject: 'Kontaktanfrage über die Website: Büro Nord',
  email: 'anna@buero.example',
  name: 'Anna Maria Huber',
  lines: [
    { label: 'Name', value: 'Anna Maria Huber' },
    { label: 'Büro', value: 'Büro Nord' },
  ],
  message: 'Wir hätten gern eine Demo.',
};

function enquiry(): Enquiry {
  const parsed = parseEnquiry(valid);
  if (!parsed.ok) throw new Error('fixture must parse');
  return parsed.enquiry;
}

describe('parsing a form submission', () => {
  test('accepts a complete contact enquiry', () => {
    expect(parseEnquiry(valid).ok).toBe(true);
  });

  test('a filled trap field is a bot, answered like a send', () => {
    expect(parseEnquiry({ ...valid, [TRAP_FIELD]: 'https://spam.example' })).toEqual({ ok: false, trap: true });
  });

  test('refuses an unknown form, a bad address and an overlong message', () => {
    expect(parseEnquiry({ ...valid, form: 'newsletter' }).ok).toBe(false);
    expect(parseEnquiry({ ...valid, email: 'anna@buero' }).ok).toBe(false);
    expect(parseEnquiry({ ...valid, email: 'a@b.example\nBcc: x@y.example' }).ok).toBe(false);
    expect(parseEnquiry({ ...valid, message: 'x'.repeat(5001) }).ok).toBe(false);
  });

  test('a line break in the subject cannot start a new mail header', () => {
    const parsed = parseEnquiry({ ...valid, subject: 'Hallo\r\nBcc: victim@example.test' });
    expect(parsed.ok && parsed.enquiry.subject).toBe('Hallo Bcc: victim@example.test');
  });
});

describe('the two mails', () => {
  test('the notification comes from the sending user and replies go to the visitor', () => {
    const mail = notification(enquiry(), 'sender@office.example', look);
    expect(mail.from.address).toBe('sender@office.example');
    expect(mail.to).toBe(identity.email);
    expect(mail.replyTo).toBe('anna@buero.example');
    expect(mail.text).toContain('Büro: Büro Nord');
    expect(mail.text).toContain('Wir hätten gern eine Demo.');
    expect(mail.html).toContain('mailto:anna@buero.example');
  });

  test('what the visitor typed is escaped in the HTML', () => {
    const parsed = parseEnquiry({ ...valid, message: '<script>alert(1)</script>' });
    if (!parsed.ok) throw new Error('must parse');
    const mail = notification(parsed.enquiry, 'sender@office.example', look);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  test('the light theme colours the page and the dark theme the footer', () => {
    expect(look.light.surface).toBe('#fafaf9');
    expect(look.dark.surface).toBe('#0f0e0d');
    expect(() => mailLook(':root { --surface: #fff; }')).toThrow(/tokens.css has no/);
  });

  test('the confirmation comes from the contact address and repeats nothing the visitor typed', () => {
    const mail = confirmation(enquiry(), look);
    expect(mail.from.address).toBe(identity.email);
    expect(mail.to).toBe('anna@buero.example');
    for (const typed of ['Anna', 'Büro Nord', 'Demo']) {
      expect(mail.text).not.toContain(typed);
      expect(mail.html).not.toContain(typed);
      expect(mail.subject).not.toContain(typed);
    }
  });
});

describe('delivering an enquiry', () => {
  const delivery = { smtp: { user: 'sender@office.example', password: 'pw' } }; // pragma: allowlist secret
  const quiet = () => {};

  test('a failed notification fails the send, so the form falls back to the mail program', async () => {
    const send = async () => {
      throw new Error('smtp down');
    };
    expect(await deliver(enquiry(), delivery, look, send, undefined, quiet)).toBe('failed');
  });

  test('a failed confirmation or Attio record does not lose an enquiry the notification carried', async () => {
    const sent: Mail[] = [];
    const send = async (mail: Mail) => {
      if (mail.to !== identity.email) throw new Error('bounced');
      sent.push(mail);
    };
    const record = async () => {
      throw new Error('attio down');
    };
    expect(await deliver(enquiry(), { ...delivery, attioApiKey: 'k' }, look, send, record, quiet)).toBe('sent');
    expect(sent.map((m) => m.to)).toEqual([identity.email]);
  });

  test('a confirmation that never answers does not hold the visitor past the deadline', async () => {
    const send = (mail: Mail) => (mail.to === identity.email ? Promise.resolve() : new Promise<void>(() => {}));
    const started = Date.now();
    const outcome = await deliver(enquiry(), delivery, look, send, undefined, quiet, 50);
    expect(outcome).toBe('sent');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('without an SMTP login there is no delivery', () => {
    expect(deliveryFrom({ SMTP_USER: 'a@b.example' })).toBeUndefined();
    expect(deliveryFrom({ SMTP_USER: 'a@b.example', SMTP_PASSWORD: 'pw', ATTIO_API_KEY: '' })?.attioApiKey).toBeUndefined(); // pragma: allowlist secret
  });
});

describe('the SMTP login', () => {
  test('hands the password to nodemailer as auth.pass, with timeouts', () => {
    const options = smtpTransportOptions({ user: 'sender@office.example', password: 'pw' }); // pragma: allowlist secret
    expect(options.auth).toEqual({ user: 'sender@office.example', pass: 'pw' }); // pragma: allowlist secret
    expect(options).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true });
    expect(options.socketTimeout).toBeGreaterThan(0);
  });
});

describe('recording in Attio', () => {
  test('upserts the person by email, then notes the enquiry on that record', async () => {
    const calls: { url: string; method?: string; body: unknown }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      const data = url.includes('/notes') ? {} : { data: { id: { record_id: 'rec-1' } } };
      return new Response(JSON.stringify(data), { status: 200 });
    }) as typeof fetch;
    await recordInAttio(enquiry(), 'key', fetchFn);
    expect(calls[0]).toMatchObject({
      url: 'https://api.attio.com/v2/objects/people/records?matching_attribute=email_addresses',
      method: 'PUT',
      body: { data: { values: { email_addresses: ['anna@buero.example'] } } },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://api.attio.com/v2/notes',
      body: { data: { parent_object: 'people', parent_record_id: 'rec-1', format: 'plaintext' } },
    });
  });

  test('the last word of a name is the surname', () => {
    expect(splitNameLastWordAsSurname('Anna Maria Huber')).toEqual({ first_name: 'Anna Maria', last_name: 'Huber', full_name: 'Anna Maria Huber' });
    expect(splitNameLastWordAsSurname('Cher')).toEqual({ first_name: 'Cher', last_name: '', full_name: 'Cher' });
  });
});

describe('the send budget', () => {
  test('allows the limit per window, then refuses until the window has passed', () => {
    const budget = new SendBudget(2, 1000);
    expect([budget.take('ip', 0), budget.take('ip', 10), budget.take('ip', 20)]).toEqual([true, true, false]);
    expect(budget.take('other', 20)).toBe(true);
    expect(budget.take('ip', 1001)).toBe(true);
  });
});
