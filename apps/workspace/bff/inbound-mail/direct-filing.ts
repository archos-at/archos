/**
 * The kill switch of direct filing alone (ADR-0137, amendment of 2026-11-03):
 * `INBOUND_MAIL_DIRECT_FILING`, Pulumi `inboundMailDirectFiling`, on by
 * default. Off (the literal `false`, trimmed, any case), a verified writer's
 * mail keeps its class (`verified_writer`, which is evidence, not a decision)
 * but no sender job is queued for it (`./receive-sender.ts`): it waits for any
 * of the project's writers, as every mail did before direct filing, with the
 * wait reason `paused`. A sender job already queued files nothing and leaves
 * the mail waiting (`direct_filing_off`). Never stricter than the rule it
 * switches off: nothing becomes releasable by its member alone. Receipt itself
 * is unchanged: pausing it is `INBOUND_MAIL_PAUSED`.
 */

/** Whether a verified writer's mail is filed directly. Read on every call, so a rollout of the variable takes effect without a code change. */
export function directFilingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.INBOUND_MAIL_DIRECT_FILING ?? '').trim().toLowerCase() !== 'false'
}
