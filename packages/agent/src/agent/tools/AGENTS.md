# Workspace tools: `packages/agent/src/agent/tools`

Tools that act on the user's workspace: drafts, files, the canvas, the MCP door, other projects.

- The working directory (`documents/`) never creates a `documents` row; only `file_draft` reaches the project, through `POST /api/internal/document-versions`.
- A tool that acts for a person forwards the BFF's signed envelope (`SignedEnvelope.headers()`, `common/bff_http.py`); never build one, never fall back to `x-grid-user-id`. Echo, never sign.
- Every other write is a proposal (`proposals_client.add_card`) the person accepts: see ADR-0105. `test_proposals.py` pins the contract.
- Resolve a document or folder only against the turn's inventory (`knowledge/inventory.get_turn_documents`); pass a person's name through unresolved.
- Ship a file operation only when a BFF applier exists for it (`apps/workspace/bff/proposals/executors.ts`).
- The `workspace__*` tools read the envelope inside each call and keep no connection; keep the runtime's `mcp_client` out (`test_workspace_client.py`).
- A tool that reads another project admits only what the BFF recorded (`note_cross_project_hand_out`).
- A canvas write everyone sees calls `policy.shared_write_refusal()` first (`test_targets_and_policy.py`).
- A new working-directory verb gets an action key in `common/status_keys.py` and its mapping in `common/tool_calls.py`.
- In drafts, NFC-normalise model text against stored text (`draft_store.normalize_draft_text`), and re-stamp any key of yours in `DraftBackend._record`.
- Every BIM number keeps its provenance (`declared`, `computed` with tolerance, `inferred`); `decidable: false` is an answer, never an error.
- A changed BIM operation or enum value updates the `ifc-spatial-reasoning` skill (`test_ifc_spatial_skill.py`); a reworded description regenerates `backend-tools.schema.json` (`test_backend_tools_schema.py`, `english-only.spec.ts`).
- A tool's usage rule goes in its description, not the prompt (ADR-0060).

Before you change a file verb, the envelope path, proposals, the MCP client, cross-project reads or `bim/`, read [`workspace-tools.md`](../../../../../docs/architecture/workspace-tools.md).
Before you change a proposal kind or its card, read [`proposed-changes.md`](../../../../../docs/architecture/proposed-changes.md).
