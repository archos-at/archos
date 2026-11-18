---
status: accepted
date: 2026-11-17
decision-makers: product owner
consulted: the brand-free census of 2026-11-15 (eight read-only scouts over every code file)
informed: everyone working in this repo
---

# The brand is swept out of the code now, not renamed on touch

Amends [ADR-0149](0149-the-product-name-is-copy-and-identifiers-carry-no-brand.md): its rule 4
("existing identifiers are frozen, and renamed when touched") and owner decision D22 for the code.

## Context and Problem Statement

ADR-0149 froze about 6,100 branded identifiers and renamed each when its file was touched. Two
weeks later the census found 9,419 brand lines still in code files: 4,668 identifier hits and
6,962 prose hits. Agents copy what they find, so every frozen name taught the next change the old
one. Rename-on-touch also made each small change carry an unrelated rename.

## Decision Outcome

The owner decided on 2026-11-17:

1. **Sweep now.** The code is swept in one wave, by areas in parallel. The phases are:
   * phase 1, mechanical: comments, test names, fixtures and local identifiers;
   * phase 2, paths;
   * phase 3, shared contracts, by expand, switch and contract;
   * phase 4, stored names, one migration per name with the owner's yes.

   The comment purge rides along, because a deleted comment needs no rename.
2. **The one agent is `agent/core/`.** The agent's package moves out of `agents/` to sit beside
   `turn/`, `tools/` and `stages/`. ARCHOS has one agent; `agents/` keeps only the helpers it
   calls. This replaces ADR-0149's map row (`agents/assistant/`), and the mention id follows the
   package. The checkpointer restores a graph by module path, so the old path stays importable as
   an alias for one release.
3. **History stays as written**, as ADR-0149 lists it. Shipped release notes, the changelog, the
   former name on the legal pages and public URL slugs are exempt too.
4. **External names stay.** The domains, the S3 buckets, the Pulumi stack and the Qdrant aliases
   are infrastructure names. A customer never reads them, and renaming them means copying every
   stored document. They are recorded as exempt.

Everything else in ADR-0149 holds: the name is copy, read from `packages/brand/identity.json`;
both brand ratchets only shrink; the neutral-name map names the target of each rename.

### Consequences

* Good, because the next agent finds no branded name to copy, and a small change no longer
  carries a rename.
* Good, because the comment purge and the rename touch each file once.
* Bad, because phases 3 and 4 still need prod deploys between their steps, and phase 4 needs
  15 to 20 owner approvals.
* Bad, because a document's summaries and metadata (`document_metadata`,
  `document_revision_retained`, the listing and the search joins) stay keyed by its file name.
  Phase 4 moves the purge to `document_id` and rewrites the agent namespace in every store at
  once; re-keying those stores by `document_id` is a follow-up the owner deferred.

### Confirmation

`scripts/check_brand_names.py` and `scripts/check_brand_prose.py`, whose baselines fall with each
phase; `task baselines:tighten` locks each gain in.
