import type { APIRoute } from 'astro';
import { deliver, deliveryFrom, smtpSender } from '../../lib/enquiry-delivery';
import { mailLook } from '../../lib/enquiry-html';
import tokensCss from '../../styles/brand/tokens.css?raw';
import sansFont from '../../styles/brand/fonts/GeneralSans-Variable.woff2?url';
import logoFont from '../../styles/brand/fonts/Switzer-Semibold.woff2?url';
import { parseEnquiry, SendBudget } from '../../lib/enquiry';

export const prerender = false;

const HOUR = 60 * 60 * 1000;
// A person sends one or two enquiries; a bot sending confirmations to strangers hits these first.
const perClient = new SendBudget(5, HOUR);
const perPod = new SendBudget(60, HOUR);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function edgeClientAddress(request: Request, clientAddress: string | undefined): string {
  return request.headers.get('x-envoy-external-address')?.trim() || clientAddress || 'unknown';
}

const fallBackToMailProgram = () => json(503, { fallback: 'mailto' });

export const POST: APIRoute = async ({ request, clientAddress, site }) => {
  const delivery = deliveryFrom(process.env);
  if (!delivery) return fallBackToMailProgram();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, {});
  }
  const parsed = parseEnquiry(body);
  // A filled trap field gets the same answer as a real send, so a bot learns nothing.
  if (!parsed.ok) return parsed.trap ? json(200, { sent: true }) : json(400, {});

  if (!perClient.take(edgeClientAddress(request, clientAddress)) || !perPod.take('pod')) {
    return fallBackToMailProgram();
  }
  const absolute = (path: string) => new URL(path, site ?? request.url).href;
  const look = mailLook(tokensCss, { sans: absolute(sansFont), logo: absolute(logoFont) });
  const outcome = await deliver(parsed.enquiry, delivery, look, smtpSender(delivery.smtp));
  return outcome === 'sent' ? json(200, { sent: true }) : fallBackToMailProgram();
};
