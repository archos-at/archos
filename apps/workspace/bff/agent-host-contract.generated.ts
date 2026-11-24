// AUTO-GENERATED from the Python sources named below — do not edit; run `uv run python scripts/generate_agent_host_contract.py`

/** The seconds a chat turn runs before the socket ends it, where the deploy sets no `CHAT_TURN_DEADLINE_SECONDS`: `TURN_DEADLINE_SECONDS` in `apps/agent-host/src/agent_host/chat_turn.py`. */
export const CHAT_TURN_DEADLINE_SECONDS = 2700.0 as const

/** The most job ids one batch status read accepts: `BATCH_STATUS_MAX_IDS` in `apps/agent-host/src/agent_host/routes/documents_jobs.py`. */
export const BATCH_STATUS_MAX_IDS = 200 as const

/** The keys `POST /v1/ingest` reads: the fields of `IngestRequest` in `apps/agent-host/src/agent_host/models/requests.py`. */
export const INGEST_REQUEST_FIELDS = ["licence_class", "ai_processing_attested", "quote_max_chars", "knowledge_edition_id", "file_ref", "collection", "document_id", "byte_size", "project_id", "project_facts", "user_id", "priority", "thumbnail_upload_url", "preview_ref", "extraction_ref", "folder_path", "document_type", "file_name", "revision_of", "authored_by", "approved_by", "approved_at", "producer", "mail_thread", "mail_origin", "screening"] as const

/** The priorities `POST /v1/ingest` accepts: `IngestRequest.priority` in `apps/agent-host/src/agent_host/models/requests.py`. */
export const INGEST_PRIORITIES = ["interactive", "bulk"] as const

/** The records of an ingest request that refuse a key they do not declare, by the key they are sent under, with the keys they declare: the `extra="forbid"` models of `IngestRequest` in `apps/agent-host/src/agent_host/models/requests.py`. */
export const INGEST_STRICT_RECORDS = {"project_facts": ["facts", "status"], "mail_thread": ["latest_sent_at", "message_count", "locale"], "mail_origin": ["sent_at", "received_at", "from_name", "from_domain", "signer_domain", "sender_trust", "forwarded_by_name", "forwarded_by_domain", "forwarded_at", "thread_document_id", "locale"], "screening": ["content_terms", "detectors"]} as const

/** The sender trusts a mail origin may carry: `SenderTrust` in `apps/agent-host/src/agent_host/models/mail_facts.py`. */
export const SENDER_TRUSTS = ["member_verified", "member_unverified", "external_verified", "external_unverified", "not_checked"] as const

/** The locales a mail record may carry: `MailLocale` in `apps/agent-host/src/agent_host/models/mail_facts.py`. */
export const MAIL_LOCALES = ["de", "en"] as const

/** The frame types the agent host hands over as a turn's steps: `STEP_FRAME_TYPES` in `apps/agent-host/src/agent_host/turn_record.py`. */
export const STEP_FRAME_TYPES = ["STEP_FINISHED", "STEP_STARTED", "SUBAGENT_ERROR", "SUBAGENT_FINISHED", "SUBAGENT_STARTED"] as const

/** The `CUSTOM` frame names it hands over as steps too: `STEP_CUSTOM_NAMES` in `apps/agent-host/src/agent_host/turn_record.py`. */
export const STEP_CUSTOM_NAMES = ["steer_applied", "steer_received"] as const

/** The most step rows the agent host keeps of one turn: `MAX_STEP_ROWS` in `apps/agent-host/src/agent_host/turn_record.py`. */
export const MAX_STEP_ROWS = 2400 as const

/** The most step frames it hands over for one turn: `MAX_STEP_FRAMES` in `apps/agent-host/src/agent_host/turn_record.py`. */
export const MAX_STEP_FRAMES = 7200 as const
