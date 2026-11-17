# The agent: `core`

The agent that answers every turn, and the per-turn conversation graph around it.

How a turn runs, and each rule in full: [`chat-agent.md`](../../../../../docs/architecture/chat-agent.md).

- Build at boot: anything that reads a file, compiles a graph or builds an index goes in
  `register.py`, and a turn varies only through `TurnConfig`. `test_build_once.py`.
- A switched-off data source stays bound and is refused at the `ToolNode`, so the tool
  payload stays one prompt-cache shard per org.
- Leave the wire names (`research_agent`, `shallow_research`, `chat_researcher`, `researcher`, …)
  alone: they are stored per turn. [The list](../../../../../docs/architecture/chat-agent.md#the-names-that-stay).
- Scope a scan of `state.messages` for this turn with `answer_pipeline.this_turn`.
- Answer a withheld tool call with a `ToolMessage`; never delete it from `tool_calls`.
- Set a `ContextVar` a tool reads in `_tools_node`, around the `ToolNode` call, never in the agent node.
- Send a synchronous call from a graph node through `asyncio.to_thread`. `test_prompt_render_off_the_loop.py`.
- A per-turn value the model reads goes in the turn context and in one of
  `context_layout.TURN_VALUES` / `CONVERSATION_VALUES`, never in `prompts/chat_static.md`.
  `test_turn_context_message.py`, `test_context_layout.py`.
- A line in `chat_static.md` passes the value test and the 5,000-token budget. `test_static_prompt_split.py`.
- After the prose settles, change only a corrected quotation (ADR-0067). `TestChatRepairPass`.
- A field the reader sees is lifted through `conversation.ANSWER_LIFTS`.

Before you change what a round of tool calls costs or runs, the answer check, the clarify
step or `chat_static.md`'s envelope and formatting rules, read their rows in
[`chat-agent.md`](../../../../../docs/architecture/chat-agent.md#obligations).
