/**
 * The kill switch of direct filing alone (ADR-0137, amendment of 2026-11-03):
 * `INBOUND_MAIL_DIRECT_FILING`, Pulumi `inboundMailDirectFiling`, on by
 * default. Off (the literal `false`, trimmed, any case), the hold classes a
 * verified writer's mail `unverified_writer`, so it waits for its member's
 * one press like any mail that only claims them, and queues no sender job;
 * a sender job already queued files nothing and leaves the mail waiting.
 * Receipt itself is unchanged: pausing it is `INBOUND_MAIL_PAUSED`.
 */

/** Whether a verified writer's mail is filed directly. Read on every call, so a rollout of the variable takes effect without a code change. */
export function directFilingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.INBOUND_MAIL_DIRECT_FILING ?? '').trim().toLowerCase() !== 'false'
}
