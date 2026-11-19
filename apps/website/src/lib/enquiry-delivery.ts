import nodemailer from 'nodemailer';
import copy from '../i18n/pages/enquiry-mail';
import identity, { withName } from './identity';
import { confirmationHtml, notificationHtml, type MailLook } from './enquiry-html';
import { enquiryText, splitNameLastWordAsSurname, type Enquiry } from './enquiry';

const SMTP_HOST = 'smtp.gmail.com';
const ATTIO_API = 'https://api.attio.com/v2';

type Env = Record<string, string | undefined>;

export interface Delivery {
  smtp: { user: string; password: string };
  attioApiKey?: string;
}

export function deliveryFrom(env: Env): Delivery | undefined {
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  if (!user || !password) return undefined;
  return { smtp: { user, password }, attioApiKey: env.ATTIO_API_KEY?.trim() || undefined };
}

export interface Mail {
  from: { name: string; address: string };
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}

/** The mail to the contact inbox, always German: from the sending user, since Gmail hides a group's own posts from its sender. */
export function notification(enquiry: Enquiry, sender: string, look: MailLook): Mail {
  const c = withName(copy.de);
  return {
    from: { name: c.notification.from, address: sender },
    to: identity.email,
    replyTo: enquiry.email,
    subject: enquiry.subject,
    text: `${c.notification.title}\n\n${enquiryText(enquiry)}\n\n--\n${c.notification.replyHint}`,
    html: notificationHtml(look, 'de', {
      title: c.notification.title,
      lines: enquiry.lines,
      message: enquiry.message,
      reply: { label: c.notification.reply, to: enquiry.email, subject: enquiry.subject },
      hint: c.notification.replyHint,
    }),
  };
}

export function confirmation(enquiry: Enquiry, look: MailLook): Mail {
  const c = withName(copy[enquiry.locale]);
  return {
    from: { name: identity.name, address: identity.email },
    to: enquiry.email,
    replyTo: identity.email,
    subject: c.confirmation.subject,
    text: [c.confirmation.title, ...c.confirmation.body].join('\n\n'),
    html: confirmationHtml(look, enquiry.locale, c.confirmation.title, c.confirmation.body),
  };
}

export type SendMail = (mail: Mail) => Promise<void>;

export function smtpSender(smtp: Delivery['smtp']): SendMail {
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: smtp });
  return async (mail) => {
    await transport.sendMail(mail);
  };
}

export async function recordInAttio(enquiry: Enquiry, apiKey: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const person = await fetchFn(`${ATTIO_API}/objects/people/records?matching_attribute=email_addresses`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ data: { values: { email_addresses: [enquiry.email], name: [splitNameLastWordAsSurname(enquiry.name)] } } }),
  });
  if (!person.ok) throw new Error(`Attio person upsert answered ${person.status}`);
  const recordId = ((await person.json()) as { data?: { id?: { record_id?: string } } }).data?.id?.record_id;
  if (!recordId) throw new Error('Attio person upsert returned no record id');
  const note = await fetchFn(`${ATTIO_API}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        parent_object: 'people',
        parent_record_id: recordId,
        title: enquiry.subject,
        format: 'plaintext',
        content: enquiryText(enquiry),
      },
    }),
  });
  if (!note.ok) throw new Error(`Attio note answered ${note.status}`);
}

export type Outcome = 'sent' | 'failed';

/** Only the notification must arrive: it already holds the enquiry if the rest fails. */
export async function deliver(
  enquiry: Enquiry,
  delivery: Delivery,
  look: MailLook,
  send: SendMail,
  record: (enquiry: Enquiry, apiKey: string) => Promise<void> = recordInAttio,
  log: (event: Record<string, unknown>) => void = (event) => console.log(JSON.stringify(event)),
): Promise<Outcome> {
  try {
    await send(notification(enquiry, delivery.smtp.user, look));
  } catch (error) {
    log({ level: 'error', event: 'enquiry_notification_failed', form: enquiry.form, error: String(error) });
    return 'failed';
  }
  const rest = await Promise.allSettled([
    send(confirmation(enquiry, look)),
    delivery.attioApiKey ? record(enquiry, delivery.attioApiKey) : Promise.resolve(),
  ]);
  const [confirmed, recorded] = rest;
  if (confirmed.status === 'rejected') {
    log({ level: 'warn', event: 'enquiry_confirmation_failed', form: enquiry.form, error: String(confirmed.reason) });
  }
  if (recorded.status === 'rejected') {
    log({ level: 'warn', event: 'enquiry_attio_failed', form: enquiry.form, error: String(recorded.reason) });
  }
  log({
    level: 'info',
    event: 'enquiry_sent',
    form: enquiry.form,
    confirmed: confirmed.status === 'fulfilled',
    attio: delivery.attioApiKey ? recorded.status === 'fulfilled' : 'off',
  });
  return 'sent';
}
