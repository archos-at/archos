import copy from '../i18n/pages/enquiry-mail';
import identity, { withName } from './identity';
import { button, infoList, mailPage, note, panel, paragraph, smtpLoginFrom, type Mail, type MailLook, type SendMail, type SmtpLogin } from './mail';
import { enquiryText, splitNameLastWordAsSurname, type Enquiry } from './enquiry';

const ATTIO_API = 'https://api.attio.com/v2';
const OPTIONAL_STEP_DEADLINE_MS = 10_000;

function withinDeadline<T>(step: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([step, late]).finally(() => clearTimeout(timer));
}

export interface Delivery {
  smtp: SmtpLogin;
  attioApiKey?: string;
}

export function deliveryFrom(env: Record<string, string | undefined>): Delivery | undefined {
  const smtp = smtpLoginFrom(env);
  return smtp ? { smtp, attioApiKey: env.ATTIO_API_KEY?.trim() || undefined } : undefined;
}

export type { Mail, SendMail };

/** The mail to the contact inbox, always German: from the sending user, since Gmail hides a group's own posts from its sender. */
export function notification(enquiry: Enquiry, sender: string, look: MailLook): Mail {
  const c = withName(copy.de);
  return {
    from: { name: c.notification.from, address: sender },
    to: identity.email,
    replyTo: enquiry.email,
    subject: enquiry.subject,
    text: `${c.notification.title}\n\n${enquiryText(enquiry)}\n\n--\n${c.notification.replyHint}`,
    html: mailPage(look, identity, {
      lang: 'de',
      title: c.notification.title,
      inboxPreview: enquiry.lines.map((line) => line.value).join(' · '),
      blocks: [
        infoList(enquiry.lines),
        panel(enquiry.message),
        button(c.notification.reply, `mailto:${enquiry.email}?subject=${encodeURIComponent(`Re: ${enquiry.subject}`)}`),
        note(c.notification.replyHint),
      ],
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
    html: mailPage(look, identity, {
      lang: enquiry.locale,
      title: c.confirmation.title,
      inboxPreview: c.confirmation.body[0] ?? '',
      blocks: c.confirmation.body.map((part, i) => paragraph(part, i === 0 ? 'ink' : 'muted')),
    }),
  };
}

export async function recordInAttio(enquiry: Enquiry, apiKey: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const person = await fetchFn(`${ATTIO_API}/objects/people/records?matching_attribute=email_addresses`, {
    method: 'PUT',
    headers,
    signal: AbortSignal.timeout(OPTIONAL_STEP_DEADLINE_MS),
    body: JSON.stringify({ data: { values: { email_addresses: [enquiry.email], name: [splitNameLastWordAsSurname(enquiry.name)] } } }),
  });
  if (!person.ok) throw new Error(`Attio person upsert answered ${person.status}`);
  const recordId = ((await person.json()) as { data?: { id?: { record_id?: string } } }).data?.id?.record_id;
  if (!recordId) throw new Error('Attio person upsert returned no record id');
  const note = await fetchFn(`${ATTIO_API}/notes`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(OPTIONAL_STEP_DEADLINE_MS),
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
  deadlineMs = OPTIONAL_STEP_DEADLINE_MS,
): Promise<Outcome> {
  try {
    await send(notification(enquiry, delivery.smtp.user, look));
  } catch (error) {
    log({ level: 'error', event: 'enquiry_notification_failed', form: enquiry.form, error: String(error) });
    return 'failed';
  }
  const rest = await Promise.allSettled([
    withinDeadline(send(confirmation(enquiry, look)), deadlineMs),
    delivery.attioApiKey ? withinDeadline(record(enquiry, delivery.attioApiKey), deadlineMs) : Promise.resolve(),
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
