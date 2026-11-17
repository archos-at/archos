-- 0241: a ledger row names its model once.
--
-- From 2026-11-11 (dev) and 2026-11-14 (prod) the agent booked every streamed
-- chat answer as `openai/gpt-6.1-terraopenai/gpt-6.1-terra`: langchain-core
-- concatenates a stream's string metadata, and OpenRouter repeats
-- `finish_reason`, and with it `model_name`, on its usage chunk. The agent now
-- folds the id (`provider_usage.model_id_once`); this repairs the rows booked
-- before it, the same way: a value that is one provider id (it has a `/`)
-- written twice becomes that id. PostHog's `llm_usage_hourly` showed no id
-- written three times, so only the double is folded. Prices and credits are
-- computed from the cost, never the model, so no amount changes.
--
-- Runs as the table owner, which row-level security does not bind (0031 does
-- not FORCE it). The hours already sent to PostHog keep the doubled label;
-- the export's cursor does not send them again.
UPDATE "llm_usage_events"
SET "model" = left("model", length("model") / 2)
WHERE length("model") % 2 = 0
  AND position('/' IN left("model", length("model") / 2)) > 0
  AND "model" = repeat(left("model", length("model") / 2), 2);
