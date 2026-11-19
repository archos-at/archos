import type { APIRoute } from 'astro';
import { captureEnquiry, type EnquiryOutcome, type EnquiryReport } from '../../lib/enquiry-analytics';
import { deliver, deliveryFrom } from '../../lib/enquiry-delivery';
import { mailLook, smtpSender } from '../../lib/mail';
import tokensCss from '../../styles/brand/tokens.css?raw';
import sansFont from '../../styles/brand/fonts/GeneralSans-Variable.woff2?url';
import logoFont from '../../styles/brand/fonts/Switzer-Semibold.woff2?url';
import { parseEnquiry, SendBudget } from '../../lib/enquiry';

export const prerender = false;

// Per client IP the edge enforces it (rateLimitWebEnquiryPerHour); this caps what one pod sends in all.
const perPod = new SendBudget(60, 60 * 60 * 1000);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function answer(report: EnquiryReport): Response {
  captureEnquiry(report);
  const fallbackReasons: EnquiryOutcome[] = ['not_configured', 'budget_spent', 'send_failed'];
  if (fallbackReasons.includes(report.outcome)) return json(503, { fallback: 'mailto', reason: report.outcome });
  // A filled trap field gets the same answer as a real send, so a bot learns nothing.
  return report.outcome === 'invalid' ? json(400, {}) : json(200, { sent: true });
}

export const POST: APIRoute = async ({ request, site }) => {
  const delivery = deliveryFrom(process.env);
  if (!delivery) return answer({ outcome: 'not_configured' });

  const parsed = parseEnquiry(await request.json().catch(() => undefined));
  if (!parsed.ok) return answer({ outcome: parsed.trap ? 'trap' : 'invalid' });
  const { form, locale } = parsed.enquiry;
  if (!perPod.take('pod')) return answer({ outcome: 'budget_spent', form, locale });

  const absolute = (path: string) => new URL(path, site ?? request.url).href;
  const look = mailLook(tokensCss, { sans: absolute(sansFont), logo: absolute(logoFont) });
  const result = await deliver(parsed.enquiry, delivery, look, smtpSender(delivery.smtp));
  return answer({ outcome: result.sent ? 'sent' : 'send_failed', form, locale, confirmed: result.confirmed, attio: result.attio });
};
