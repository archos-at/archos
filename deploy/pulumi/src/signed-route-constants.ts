/** The signed internal routes' edge names, path, body ceiling and timeout, kept out of `constants.ts`. */

/**
 * The signed internal routes at the edge (`/api/internal/signed/*`): requests
 * from callers outside the cluster that push bytes in, each carrying an
 * RFC 9421 signature the BFF checks before it reads the body
 * (`requireInternalSignature`, ADR-0138). Today the one caller is the inbound
 * mail Worker (`platform/inbound-mail-worker.js`).
 *
 * They get an HTTPRoute of their own (`app/httproutes.ts`), for three reasons
 * the app route's policy cannot serve:
 *
 *   - **A body ceiling without buffering.** The route forwards only a request
 *     whose `Content-Length` is a decimal of at most `maxBodyBytes`, matched on
 *     the header; anything else (larger, chunked, absent) gets a 413 from
 *     Envoy itself. Envoy Gateway's `requestBuffer` would enforce the same
 *     number by holding every body in the proxy, and the proxy's 512Mi limit
 *     (`PLATFORM_RESOURCES.envoyProxy`) would then be a dozen unauthenticated
 *     27 MiB uploads away from an OOM that takes the whole edge down. The
 *     header bounds the body anyway: the HTTP codec frames by it.
 *   - **No per-client bucket.** Every inbound mail arrives from Cloudflare's
 *     shared egress addresses, which other Cloudflare customers' traffic
 *     shares, so a per-IP bucket would let a neighbour defer our mail
 *     (RT-S9). The limits that mean something are the BFF's, per signing key,
 *     address and office, counted after the signature (DECISION D18).
 *   - **A short timeout.** The Worker gives up after 90 s and its sender
 *     retries; an upstream budget of an hour would only let a slow request
 *     hold a frontend connection that long.
 */
export const SIGNED_INTERNAL_ROUTE = {
  /** HTTPRoute name; the BackendTrafficPolicy attaches to it by name. */
  // New with project mail, so brand-free in both projects (ADR-0147): nothing to rename later.
  routeName: "app-signed",
  /**
   * The path family. Must equal `SIGNED_INTERNAL_PREFIX` in
   * `apps/workspace/bff/api/handler.ts` and `signedPathPrefix` in
   * `contracts/inbound-mail-contract.json` (the specs check the latter).
   */
  pathPrefix: "/api/internal/signed/",
  /**
   * The largest `Content-Length` forwarded: 27 MiB, one above the BFF's own
   * 26 MiB message cap (`maxRawMessageBytes` in the contract), so the BFF's 413 with its
   * verdict is the one a real mail meets, never this one. Equal to
   * `edgeMaxBodyBytes` in the contract.
   */
  maxBodyBytes: 27 * 1024 * 1024,
  /** Upstream budget per request, from the end of the request body. */
  requestTimeout: "120s",
  /** The HTTPRouteFilter that answers an over-limit or length-less request. */
  refusalFilterName: "signed-body-limit",
} as const;
