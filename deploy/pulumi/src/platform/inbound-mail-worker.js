// @ts-check
/**
 * Project mail: the Cloudflare Email Worker (deployed by `inbound-mail.ts`).
 *
 * It does not parse. It reads the raw RFC 5322 bytes Cloudflare received,
 * signs them for the BFF, posts them, and turns the BFF's answer into accept,
 * reject or retry. Everything that decides anything about a project (address,
 * office, sender, DKIM, limits) lives in the BFF, where it is tested and
 * audited (ADR-0138). The webhook's contract is `contracts/inbound-mail-contract.json`;
 * the constants below restate it, and `inbound-mail-worker.spec.ts` holds them
 * to that file.
 *
 * ## The one thing it decides: is this a project address at all
 *
 * One literal routing rule hands it mail: `<ADDRESS_LOCAL_PART>@<ADDRESS_DOMAIN>`
 * (`project@inbox.example.org`), and Cloudflare's subaddressing makes every
 * `project+<detail>@inbox.example.org` fall back to that rule (ADR-0138). So it
 * receives the project addresses, `project+<slug>.<token>@…`, and also the bare
 * `project@…` and whatever spam guesses after the `+`. It checks the recipient's
 * SHAPE, the rule of `contracts/inbound-address.json`, which the BFF's parser
 * runs too: its own domain, its own local part before the first `+`, and a
 * token after the last dot of the subaddress. A project-shaped address goes to
 * the BFF. Anything else is refused here with `UNKNOWN_ADDRESS_TEXT`, without
 * a request: spam to random subaddresses never reaches the webhook.
 *
 * The shape is public, so splitting the two texts on it tells a prober
 * nothing: whether a project-shaped address EXISTS is answered only by the
 * BFF, with one bounce text (`REJECT_TEXT_TEMPLATE`) for every refusal.
 *
 * ## The request: RFC 9421 over a fixed-length body
 *
 * The BFF accepts the request only with an HTTP Message Signature (RFC 9421,
 * `hmac-sha256`) over `@method`, `@target-uri`, `content-digest`,
 * `content-length` and the two envelope headers, with a `Content-Digest`
 * (RFC 9530) of the exact bytes (`requireInternalSignature` in
 * `apps/workspace/bff/internal-auth.ts`). So the Worker buffers the message:
 * the digest is known only after the last byte, and a fixed-length body is
 * what carries a real `Content-Length` (a stream body goes out chunked, and the
 * BFF refuses a request it cannot hold to an exact length). Workers Paid is a
 * launch prerequisite for CPU time, not memory: both plans give an isolate
 * 128 MB, but Free allows 10 ms of CPU per invocation and Paid 30 s by default
 * (up to 5 min) (developers.cloudflare.com/workers/platform/limits, read
 * 2026-10-27). Copying up to 25 MiB into an ArrayBuffer and hashing it with
 * SHA-256 runs well past 10 ms for a large mail; on Free the handler then
 * fails, which the verdict contract makes a temporary error, so the sender
 * retries for days and the mail never arrives. A small mail may fit in 10 ms.
 * Gate G5 measures the CPU of a 25 MiB mail (DECISION D19). There is no fallback
 * that drops the digest: a replay is then the same bytes, which the BFF
 * answers as a duplicate.
 *
 * The signer is written by hand on WebCrypto, because the Worker has no
 * bundler. `contracts/inbound-mail-signature.json` pins it: the spec makes this
 * module produce every vector's request byte for byte, and the BFF's spec
 * verifies the same vectors with the library the BFF uses.
 *
 * The key is the one entry of the BFF's key map (`INBOUND_MAIL_SIGNING_KEYS`)
 * this Worker signs with, its secret base64 as in the map. Rotation adds the
 * successor to the map first, then moves this Worker to it (the BFF accepts
 * both meanwhile), then drops the old one (`docs/deployment/kubernetes.md` §3c).
 *
 * ## The verdict contract
 *
 * A bounce is permanent: the sender's server gives up and the mail is gone. A
 * thrown error is temporary: Cloudflare answers the sending server with a 4xx
 * SMTP code and it retries for days. So the Worker bounces only when the BFF
 * says so explicitly, and treats every other failure as ours to fix:
 *
 *   - 2xx: accepted (held, dropped as automatic mail, or a duplicate).
 *   - 4xx WITH `x-inbound-verdict: reject`: a permanent refusal (unknown or
 *     revoked address, the office has the feature off, an oversized mail).
 *     `setReject` with the bounce text (`REJECT_TEXT_TEMPLATE`).
 *   - Anything else throws, so the sender retries: a refused signature, a
 *     paused deployment, a rate limit, a truncated body, 5xx, 3xx, a network
 *     error, and a BFF that has not answered within `BFF_TIMEOUT_MS`.
 *
 * A status alone never bounces. A rotated key (401), a `BFF_URL` that points at
 * the wrong host (404) or the edge's own 413 all look like refusals by status,
 * and none of them is the sender's fault.
 *
 * ## The pause
 *
 * `PAUSED` ("true") makes every delivery to a project address a temporary
 * failure before anything is read or sent: the sending servers keep the mail
 * and retry. It is the first lever in an incident, and the state of the first
 * promote (`inboundMailPaused`). The BFF has the same switch
 * (`INBOUND_MAIL_PAUSED`), which answers 503; the Worker's takes effect
 * the moment Pulumi updates the binding, without waiting for a frontend
 * rollout.
 *
 * ## Runtime facts this relies on, as documented by Cloudflare
 *
 *   - `message.raw` is a `ReadableStream` of the whole message and
 *     `message.rawSize` its size; inbound mail is capped at 25 MiB
 *     (developers.cloudflare.com/email-routing/email-workers/runtime-api/,
 *     last updated 2026-10-15, and /email-service/platform/limits/).
 *   - A fetch with an `ArrayBuffer`-backed body sends `Content-Length`; a
 *     stream body is sent chunked (developers.cloudflare.com/workers/runtime-apis/request/).
 *   - A thrown error is a temporary SMTP failure. Cloudflare does not document
 *     it; gate G2 proves it and G8 re-proves it after a `compatibilityDate` bump.
 *
 * `redirect: "manual"` is a security setting, not a nicety. A followed 301/302
 * turns the POST into a GET and re-sends the headers to wherever the redirect
 * points. A 3xx is unmapped, so it throws.
 *
 * Dependency-free on purpose: `inbound-mail.ts` uploads this file verbatim as
 * the Worker's only module. It is still type-checked: `// @ts-check` above,
 * the handler typed as `ExportedHandler<Env>` from `@cloudflare/workers-types`,
 * and `tsconfig.worker.json` runs it through `tsc` in `npm run typecheck`. It
 * exports only the handler and plain strings and numbers: a module Worker's
 * named exports are read as entrypoints.
 */

/**
 * The Worker's bindings, set by `inbound-mail.ts`.
 *
 * @typedef {object} Env
 * @property {string} BFF_URL The app origin, e.g. `https://app.example.at`: the origin of `WORKOS_REDIRECT_URI`, which the BFF checks `@target-uri` against.
 * @property {string} SIGNING_KEY_ID The keyid this Worker signs with, a key of `INBOUND_MAIL_SIGNING_KEYS`.
 * @property {string} SIGNING_KEY Its secret, base64 as in the key map.
 * @property {string} PAUSED `"true"` while deliveries are paused.
 * @property {string} ADDRESS_DOMAIN The receiving domain, `inboundMailDomain` (e.g. `inbox.example.org`), as the BFF's `INBOUND_MAIL_DOMAIN`.
 * @property {string} ADDRESS_LOCAL_PART The local part in front of the `+`, `inboundMailLocalPart` (e.g. `project`), as the BFF's `INBOUND_MAIL_LOCAL_PART`.
 * @property {string} [LANDING_URL] The public website's origin, `https://<webDomain>`, as the BFF's `LANDING_URL`: the bounce text's help and privacy links. Missing or malformed, the bounce carries no link.
 */

/**
 * A project token: 12 characters of lowercased RFC 4648 base32. Must equal
 * `tokenPattern` in `contracts/inbound-address.json` (the spec checks).
 */
export const TOKEN_PATTERN = "^[a-z2-7]{12}$";

const TOKEN = new RegExp(TOKEN_PATTERN);

/** The BFF route, relative to `BFF_URL`. `path` in the contract. */
export const INBOUND_MAIL_PATH = "/api/internal/signed/inbound-mail";

/** Response header by which the BFF marks a refusal as permanent. */
export const VERDICT_HEADER = "x-inbound-verdict";

/** The one value of `VERDICT_HEADER` that bounces the mail. */
export const VERDICT_REJECT = "reject";

/** The SMTP envelope recipient, as the contract's `envelopeEncoding` writes it. */
export const ENVELOPE_TO_HEADER = "x-envelope-to";

/** The SMTP envelope sender (`MAIL FROM`), likewise. */
export const ENVELOPE_FROM_HEADER = "x-envelope-from";

/** How a null reverse-path (an empty envelope sender) is written. */
export const NULL_SENDER = "<>";

/** The one signature label (RFC 9421 §4.1). The BFF accepts any one label. */
export const SIGNATURE_LABEL = "sig";

/** `alg` of the signature. */
export const SIGNATURE_ALGORITHM = "hmac-sha256";

/** `expires - created`. The BFF refuses more than 300. */
export const SIGNATURE_LIFETIME_S = 300;

/**
 * How long the Worker waits for the BFF. A hung BFF then aborts the fetch,
 * which throws like a network error, so the sender retries. The BFF does no
 * parsing in the request: it stages the bytes in object storage and answers,
 * so 25 MiB at a pessimistic 1 MB/s plus connect slack fits.
 */
export const BFF_TIMEOUT_MS = 90_000;

/**
 * The one bounce text for a project-shaped address, identical for every
 * refusal, so the bounce cannot tell an unknown address from an office that
 * switched the feature off or an oversized message. ASCII: it travels as the
 * SMTP reply text, which is ASCII unless the sending server negotiated
 * SMTPUTF8. The help page tells the sender what to do instead; the privacy
 * link is there because a refused mail was still received and processed.
 *
 * A template: `SITE_PLACEHOLDER` is the public website's origin, the
 * `LANDING_URL` binding, so the links follow the stack's `webDomain`
 * (`rejectText` in `contracts/inbound-mail-contract.json`).
 */
export const REJECT_TEXT_TEMPLATE =
  "This message could not be delivered: the address is unknown or no longer valid. " +
  "Help: {site}/e-mail-eingang/ Privacy: {site}/datenschutz/";

/** What `REJECT_TEXT_TEMPLATE` names the website's origin by. */
export const SITE_PLACEHOLDER = "{site}";

/** The longest origin the bounce links to, so the SMTP reply stays short. */
export const SITE_MAX_LENGTH = 64;

/**
 * The bounce without its links, when `LANDING_URL` is missing or not an
 * origin. Still a refusal: a misconfigured link must not turn a permanent
 * answer into a temporary failure the sender retries for days.
 */
export const REJECT_TEXT_WITHOUT_SITE =
  "This message could not be delivered: the address is unknown or no longer valid.";

/** `http(s)://host[:port]`, ASCII, nothing after the host. */
const ORIGIN = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$/i;

/** The bounce for an address that is not project-shaped: a typo, a name nobody routed, a guess. */
export const UNKNOWN_ADDRESS_TEXT = "Unknown address: this message was not delivered.";

/** The components the signature covers, in order. */
const COVERED_COMPONENTS = [
  "@method",
  "@target-uri",
  "content-digest",
  "content-length",
  ENVELOPE_TO_HEADER,
  ENVELOPE_FROM_HEADER,
];

/**
 * The bounce text for this deployment: the template with the website's
 * origin, trimmed and without trailing slashes, or the text without links.
 *
 * @param {string | undefined} site
 * @returns {string}
 */
function rejectText(site) {
  const origin = (site ?? "").trim().replace(/\/+$/, "");
  if (origin.length > SITE_MAX_LENGTH || !ORIGIN.test(origin)) return REJECT_TEXT_WITHOUT_SITE;
  return REJECT_TEXT_TEMPLATE.split(SITE_PLACEHOLDER).join(origin);
}

/** ASCII-only lowercasing, so `K` (Kelvin) cannot fold onto `k`. */
function asciiLower(/** @type {string} */ value) {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Whether `recipient` has the shape of a project address: after dropping
 * surrounding `<>` and the quotes of a quoted local part, and ASCII
 * lowercasing, the domain is `env.ADDRESS_DOMAIN`, the text before the FIRST
 * `+` is `env.ADDRESS_LOCAL_PART`, and what follows the LAST dot of the rest
 * (or the whole rest) matches `TOKEN_PATTERN`.
 *
 * @param {string} recipient
 * Throws (a temporary failure) when either binding is missing.
 *
 * @param {Env} env
 * @returns {boolean}
 */
function isProjectRecipient(recipient, env) {
  const domain = asciiLower(env.ADDRESS_DOMAIN ?? "");
  const localPart = asciiLower(env.ADDRESS_LOCAL_PART ?? "");
  if (domain === "" || localPart === "") {
    // A fault of ours, never the sender's: a retry, not a bounce.
    throw new Error("inbound-mail: ADDRESS_DOMAIN or ADDRESS_LOCAL_PART is not bound; asking the sender to retry");
  }
  const trimmed = recipient.trim().replace(/^<|>$/g, "");
  const at = trimmed.lastIndexOf("@");
  if (at === -1 || asciiLower(trimmed.slice(at + 1)) !== domain) return false;
  let local = trimmed.slice(0, at);
  if (local.length >= 2 && local.startsWith('"') && local.endsWith('"')) {
    local = local.slice(1, -1);
  }
  local = asciiLower(local);
  const plus = local.indexOf("+");
  if (plus === -1 || local.slice(0, plus) !== localPart) return false;
  const detail = local.slice(plus + 1);
  return TOKEN.test(detail.slice(detail.lastIndexOf(".") + 1));
}

/**
 * An envelope address as a header value: every UTF-8 byte outside 0x21-0x7E,
 * and `%`, as `%XX`, so `decodeURIComponent` restores it; an empty sender as
 * `NULL_SENDER`, never an empty header. Header values must be ASCII, and
 * SMTPUTF8 addresses are not.
 *
 * @param {string} address
 * @returns {string}
 */
function envelopeHeader(address) {
  if (address === "") return NULL_SENDER;
  let encoded = "";
  for (const byte of new TextEncoder().encode(address)) {
    encoded +=
      byte >= 0x21 && byte <= 0x7e && byte !== 0x25
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/**
 * Standard base64 of `bytes`, chunked so a long input never overflows the
 * argument list of `String.fromCharCode`.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The signed request's headers: the RFC 9530 digest, the envelope, and the
 * RFC 9421 `Signature-Input` and `Signature` over the signature base of
 * §2.5, one line per covered component and `@signature-params` last. The
 * component values here contain no surrounding whitespace, so they enter the
 * base as they are.
 *
 * @param {{ url: string, body: Uint8Array, envelopeTo: string, envelopeFrom: string, env: Env }} input
 * @returns {Promise<Record<string, string>>}
 */
async function signedHeaders({ url, body, envelopeTo, envelopeFrom, env }) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  /** @type {Record<string, string>} */
  const fields = {
    "content-digest": `sha-256=:${base64(digest)}:`,
    "content-length": String(body.byteLength),
    [ENVELOPE_TO_HEADER]: envelopeTo,
    [ENVELOPE_FROM_HEADER]: envelopeFrom,
  };
  const created = Math.floor(Date.now() / 1000);
  const params =
    `(${COVERED_COMPONENTS.map((c) => `"${c}"`).join(" ")})` +
    `;created=${created};expires=${created + SIGNATURE_LIFETIME_S}` +
    `;keyid="${env.SIGNING_KEY_ID}";alg="${SIGNATURE_ALGORITHM}"`;
  const base = [
    `"@method": POST`,
    `"@target-uri": ${url}`,
    ...COVERED_COMPONENTS.slice(2).map((name) => `"${name}": ${fields[name]}`),
    `"@signature-params": ${params}`,
  ].join("\n");
  const secret = Uint8Array.from(atob(env.SIGNING_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)));
  return {
    "content-type": "message/rfc822",
    "content-digest": fields["content-digest"],
    [ENVELOPE_TO_HEADER]: envelopeTo,
    [ENVELOPE_FROM_HEADER]: envelopeFrom,
    "signature-input": `${SIGNATURE_LABEL}=${params}`,
    signature: `${SIGNATURE_LABEL}=:${base64(mac)}:`,
  };
}

/** The BFF's correlation header: the same id is on its log line and its trace. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * One line per delivery for Cloudflare's Workers Logs (`observability.logs` in
 * `inbound-mail.ts`, invocation logs off so no envelope address is stored):
 * what the Worker did, the BFF's status and its request id, nothing about the
 * message. Until 2026-11 the Worker logged nothing and observability was off,
 * so two days of every delivery thrown back at the senders left no trace at
 * Cloudflare; a refusal is now a line with the BFF's request id to follow.
 *
 * @param {"accepted" | "rejected" | "retry" | "unknown_address" | "paused"} outcome
 * @param {Response | null} response
 */
function report(outcome, response) {
  const line = {
    event: "inbound_mail_delivery",
    outcome,
    status: response ? response.status : null,
    verdict: response ? response.headers.get(VERDICT_HEADER) : null,
    requestId: response ? response.headers.get(REQUEST_ID_HEADER) : null,
  };
  if (outcome === "retry") console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

/**
 * Whether the BFF's answer is an explicit, permanent refusal.
 *
 * @param {Response} response
 * @returns {boolean}
 */
function isExplicitReject(response) {
  return (
    response.status >= 400 &&
    response.status < 500 &&
    response.headers.get(VERDICT_HEADER) === VERDICT_REJECT
  );
}

/** @type {ExportedHandler<Env>} */
export default {
  async email(message, env) {
    if (!isProjectRecipient(message.to, env)) {
      message.setReject(UNKNOWN_ADDRESS_TEXT);
      report("unknown_address", null);
      return;
    }
    if (env.PAUSED === "true") {
      report("paused", null);
      // Before a byte is read: the sending server keeps the message.
      throw new Error("inbound-mail: deliveries are paused; asking the sender to retry");
    }

    const body = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const url = new URL(INBOUND_MAIL_PATH, env.BFF_URL).href;
    const headers = await signedHeaders({
      url,
      body,
      envelopeTo: envelopeHeader(message.to),
      envelopeFrom: envelopeHeader(message.from),
      env,
    });

    // A network error or the timeout rejects here and propagates: Cloudflare
    // answers the sending server with a temporary failure and it retries.
    // The body is a Uint8Array, so the runtime sends the Content-Length the
    // signature covers.
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(BFF_TIMEOUT_MS),
    });

    if (response.status >= 200 && response.status < 300) {
      report("accepted", response);
      return;
    }

    if (isExplicitReject(response)) {
      message.setReject(rejectText(env.LANDING_URL));
      report("rejected", response);
      return;
    }

    report("retry", response);
    // Not an explicit verdict: a misconfiguration, an outage or back-pressure
    // on our side. Throw, so the sender retries and nothing is lost.
    throw new Error(
      `inbound-mail: the BFF answered ${response.status} without a reject verdict; ` +
        "asking the sender to retry",
    );
  },
};
