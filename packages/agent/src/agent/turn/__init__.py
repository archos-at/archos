"""The per-turn request harness for the chat workflow.

Everything that runs once per chat turn and is NOT the answering agent lives
here: parsing what the request states about the turn, loading its context and
document inventory, binding the per-turn registries, admitting the turn
against capacity and budget, lifting the finished graph state onto the wire
response, and streaming it. The workflow entry point
(:mod:`agent.agents.piloti.conversation_register`) composes these
units; each is a small tested function with an explicit signature, so a fix in
one can be tested without standing up an agent-runtime workflow.

Nothing here imports ``agent_host``: the API tier hosts this workflow and depends
on it, never the other way (the ``agent-api-seam`` import-linter contract).
Nothing here imports agent state at runtime either: ``response.py`` and
``dispatch.py`` type against it under ``TYPE_CHECKING`` only.

Rules for a change here (why, and the live answer's own rules:
``docs/architecture/agent-package.md``):

* A wire field or stage fact goes on ``TurnResult`` (``common/wire_v2.py``), is
  lifted in :func:`response.build_result`, and gets a test that reads it back.
  Nothing else fails: a field nobody lifts is set, valid and invisible.
* Setup I/O joins the existing ``asyncio.gather`` and fails open on its own;
  in series it lands on the time-to-first-byte path.
* Every generator in the turn is closed with ``contextlib.aclosing``.
* Everything fails open: the turn degrades to the buffered turn it was.
"""
